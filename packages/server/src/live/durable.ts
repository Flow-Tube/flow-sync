import { DurableObject } from "cloudflare:workers";
import { Group } from "../group.ts";
import { HttpError } from "../http/errors.ts";
import { LIVE_PROTOCOL } from "../routes/live.ts";
import { openD1 } from "../storage/d1.ts";
import { type Connections, LiveHub, type LiveSocket } from "./hub.ts";
import type { LiveFactory, LiveRelay } from "./relay.ts";

export interface LiveEnv {
  DB: D1Database;
  LIVE: DurableObjectNamespace<LiveRoom>;
}

/** Set by the Worker after it checked the token; the room is reachable only through the Worker. */
const DID = "x-flow-sync-did";
const EXPIRES = "x-flow-sync-expires";

interface Attachment {
  did: string;
  expires: number;
}

/** Keeps who each socket belongs to on the socket itself, so it survives hibernation. */
function hibernatingConnections(ctx: DurableObjectState): Connections {
  const attachment = (socket: LiveSocket) =>
    (socket as WebSocket).deserializeAttachment() as Attachment | null;
  return {
    get: (socket) => {
      const found = attachment(socket);
      return found ? { ...found, socket } : undefined;
    },
    list: () =>
      ctx.getWebSockets().flatMap((socket) => {
        const found = attachment(socket);
        return found ? [{ ...found, socket }] : [];
      }),
    add: ({ did, expires, socket }) =>
      (socket as WebSocket).serializeAttachment({ did, expires } satisfies Attachment),
    delete: (socket) => {
      const had = attachment(socket) !== null;
      (socket as WebSocket).serializeAttachment(null);
      return had;
    },
  };
}

/** One room per instance holds every live socket, using the WebSocket Hibernation API. */
export class LiveRoom extends DurableObject<LiveEnv> {
  readonly #hub: LiveHub;

  constructor(ctx: DurableObjectState, env: LiveEnv) {
    super(ctx, env);
    this.#hub = new LiveHub(new Group(openD1(env.DB).meta), Date.now, hibernatingConnections(ctx));
  }

  override async fetch(request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.#hub.join(request.headers.get(DID) ?? "", Number(request.headers.get(EXPIRES)), server);
    await this.#schedule();
    const offered = request.headers.get("sec-websocket-protocol")?.split(",") ?? [];
    const headers = new Headers();
    if (offered.some((p) => p.trim() === LIVE_PROTOCOL))
      headers.set("sec-websocket-protocol", LIVE_PROTOCOL);
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await this.#hub.relay(socket, typeof message === "string" ? message : new Uint8Array(message));
  }

  override async webSocketClose(socket: WebSocket) {
    this.#hub.leave(socket);
  }

  override async webSocketError(socket: WebSocket) {
    this.#hub.leave(socket);
  }

  /** A stored roster entry may remove a device, so connections are checked now too. */
  async changed(did: string): Promise<void> {
    this.#hub.changed(did);
    await this.sweep();
  }

  async sweep(): Promise<void> {
    await this.#hub.sweep();
    await this.#schedule();
  }

  override async alarm() {
    await this.sweep();
  }

  /** Wakes at the earliest token expiry instead of polling, writing the alarm only when it moves. */
  async #schedule(): Promise<void> {
    const expiries = hibernatingConnections(this.ctx)
      .list()
      .map((c) => c.expires);
    const next = expiries.length ? Math.min(...expiries) : null;
    if ((await this.ctx.storage.getAlarm()) === next) return;
    await (next === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(next));
  }
}

export function durableLive(namespace: DurableObjectNamespace<LiveRoom>): LiveFactory<LiveRelay> {
  const room = () => namespace.getByName("live");
  return () => ({
    upgrade: async (c) => {
      // As on Node, a plain request to the live route finds nothing.
      if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw new HttpError("not_found");
      const headers = new Headers(c.req.raw.headers);
      headers.set(DID, c.get("did"));
      headers.set(EXPIRES, String(c.get("tokenExpires")));
      return room().fetch(new Request(c.req.raw, { headers }));
    },
    changed: (did) => room().changed(did),
  });
}
