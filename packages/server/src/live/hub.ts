import { fromHex, ObjectType, parseObject, toHex, verifyObject } from "@flow-sync/protocol";
import type { Group } from "../group.ts";
import { RateLimiter } from "../limits/counters.ts";
import { LIMITS } from "../limits.ts";

const POLICY_VIOLATION = 1008;
const UNSUPPORTED_DATA = 1003;
const MAX_CONNECTIONS_PER_DEVICE = 2;

export interface LiveSocket {
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number): void;
}

export interface Connection {
  did: string;
  expires: number;
  socket: LiveSocket;
}

/** Where a hub keeps its connections, so a host can keep them outside the hub's memory. */
export interface Connections {
  get(socket: LiveSocket): Connection | undefined;
  list(): Connection[];
  add(connection: Connection): void;
  /** Returns false when the socket had already left. */
  delete(socket: LiveSocket): boolean;
}

export function memoryConnections(): Connections {
  const map = new Map<LiveSocket, Connection>();
  return {
    get: (socket) => map.get(socket),
    list: () => [...map.values()],
    add: (connection) => map.set(connection.socket, connection),
    delete: (socket) => map.delete(socket),
  };
}

/** Relays sealed live messages between a group's connected devices and keeps nothing. */
export class LiveHub {
  readonly #connections: Connections;
  readonly #rate = new RateLimiter(LIMITS.liveRate, 1000);
  readonly #group: Group;
  readonly #now: () => number;

  constructor(group: Group, now: () => number, connections = memoryConnections()) {
    this.#group = group;
    this.#now = now;
    this.#connections = connections;
  }

  join(did: string, expires: number, socket: LiveSocket): void {
    const open = this.#connections.list().filter((c) => c.did === did).length;
    if (open >= MAX_CONNECTIONS_PER_DEVICE) {
      socket.close(POLICY_VIOLATION);
      return;
    }
    this.#connections.add({ did, expires, socket });
    this.#announce();
  }

  leave(socket: LiveSocket): void {
    if (this.#connections.delete(socket)) this.#announce();
  }

  /** Forwards one message after the same checks a reader makes, or closes the sender. */
  async relay(socket: LiveSocket, data: Uint8Array | string): Promise<void> {
    const from = this.#connections.get(socket);
    if (!from) return;
    if (typeof data === "string") return this.#close(from, UNSUPPORTED_DATA);
    const state = await this.#group.claimed();
    const member = state.members.get(from.did);
    const now = this.#now();
    if (
      !member ||
      from.expires <= now ||
      data.length > LIMITS.liveMessage ||
      this.#rate.take(from.did, now)
    ) {
      return this.#close(from, POLICY_VIOLATION);
    }
    try {
      const object = parseObject(data, fromHex(state.group));
      const { header } = object;
      const valid = header.type === ObjectType.live && header.epoch === state.epoch;
      if (!valid || toHex(header.sender) !== from.did) throw new Error("invalid live message");
      verifyObject(object, member.sig);
    } catch {
      return this.#close(from, POLICY_VIOLATION);
    }
    const copy = data.slice();
    for (const other of this.#connections.list())
      if (other.did !== from.did) other.socket.send(copy);
  }

  /** Tells the group's other connected devices that [did] stored something new, so they sync now. */
  changed(did: string): void {
    const message = JSON.stringify({ type: "changed" });
    for (const connection of this.#connections.list())
      if (connection.did !== did) connection.socket.send(message);
  }

  /** Closes connections whose token expired or whose device was removed. */
  async sweep(): Promise<void> {
    const state = await this.#group.roster();
    for (const connection of this.#connections.list()) {
      if (!state?.members.has(connection.did) || connection.expires <= this.#now()) {
        this.#close(connection, POLICY_VIOLATION);
      }
    }
  }

  #close(connection: Connection, code: number): void {
    connection.socket.close(code);
    this.leave(connection.socket);
  }

  #announce(): void {
    const connections = this.#connections.list();
    const online = [...new Set(connections.map((c) => c.did))].sort();
    const message = JSON.stringify({ type: "peers", online });
    for (const connection of connections) connection.socket.send(message);
  }
}
