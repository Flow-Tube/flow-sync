import type { UpgradeWebSocket, WSMessageReceive } from "hono/ws";
import { LiveHub, type LiveSocket } from "./hub.ts";
import type { LiveFactory, LiveRelay } from "./relay.ts";

async function bytesOf(data: WSMessageReceive): Promise<Uint8Array | string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data);
}

/** A relay in this process; the runtime sweeps it on a timer. */
export function processLive(
  upgradeWebSocket: UpgradeWebSocket,
): LiveFactory<LiveRelay & { sweep(): Promise<void> }> {
  return (group, now) => {
    const hub = new LiveHub(group, now);
    return {
      upgrade: upgradeWebSocket((c) => {
        let socket: LiveSocket | undefined;
        return {
          onOpen: (_event, ws) => {
            socket = ws;
            hub.join(c.get("did"), c.get("tokenExpires"), ws);
          },
          onMessage: async (event) => {
            if (socket) await hub.relay(socket, await bytesOf(event.data));
          },
          onClose: () => {
            if (socket) hub.leave(socket);
          },
        };
      }),
      changed: (did) => hub.changed(did),
      sweep: () => hub.sweep(),
    };
  };
}
