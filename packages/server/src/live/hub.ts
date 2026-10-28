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

/** Relays sealed live messages between a group's connected devices and keeps nothing. */
export class LiveHub {
  readonly #connections = new Set<Connection>();
  readonly #rate = new RateLimiter(LIMITS.liveRate, 1000);
  readonly #group: Group;
  readonly #now: () => number;

  constructor(group: Group, now: () => number) {
    this.#group = group;
    this.#now = now;
  }

  join(did: string, expires: number, socket: LiveSocket): Connection | undefined {
    const open = [...this.#connections].filter((c) => c.did === did).length;
    if (open >= MAX_CONNECTIONS_PER_DEVICE) {
      socket.close(POLICY_VIOLATION);
      return undefined;
    }
    const connection = { did, expires, socket };
    this.#connections.add(connection);
    this.#announce();
    return connection;
  }

  leave(connection: Connection): void {
    if (this.#connections.delete(connection)) this.#announce();
  }

  /** Forwards one message after the same checks a reader makes, or closes the sender. */
  async relay(from: Connection, data: Uint8Array | string): Promise<void> {
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
    for (const other of this.#connections) if (other.did !== from.did) other.socket.send(copy);
  }

  /** Closes connections whose token expired or whose device was removed. */
  async sweep(): Promise<void> {
    const state = await this.#group.roster();
    for (const connection of this.#connections) {
      if (!state?.members.has(connection.did) || connection.expires <= this.#now()) {
        this.#close(connection, POLICY_VIOLATION);
      }
    }
  }

  #close(connection: Connection, code: number): void {
    connection.socket.close(code);
    this.leave(connection);
  }

  #announce(): void {
    const online = [...new Set([...this.#connections].map((c) => c.did))].sort();
    const message = JSON.stringify({ type: "peers", online });
    for (const connection of this.#connections) connection.socket.send(message);
  }
}
