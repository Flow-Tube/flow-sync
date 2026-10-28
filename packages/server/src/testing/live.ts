import type { AddressInfo } from "node:net";
import { LIVE_PROTOCOL } from "../routes/live.ts";
import { listen } from "../runtime/node.ts";
import type { testApp } from "./app.ts";

/** Serves a test app over real HTTP so WebSocket clients can connect. */
export async function serveLive(h: ReturnType<typeof testApp>) {
  const port = await new Promise<number>((resolve) => {
    const server = listen(h, 0, (info: AddressInfo) => resolve(info.port));
    closers.push(() => new Promise((done) => server.close(() => done())));
  });
  return port;
}

const closers: (() => Promise<void>)[] = [];
const sockets: WebSocket[] = [];

export async function closeServers(): Promise<void> {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(closers.splice(0).map((close) => close()));
}

export interface LiveClient {
  socket: WebSocket;
  next(): Promise<string | Uint8Array>;
  closed: Promise<number>;
}

export function connect(port: number, token: string): Promise<LiveClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/live`, [
    LIVE_PROTOCOL,
    `bearer.${token}`,
  ]);
  socket.binaryType = "arraybuffer";
  sockets.push(socket);
  const queue: (string | Uint8Array)[] = [];
  const waiting: ((value: string | Uint8Array) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const value = typeof event.data === "string" ? event.data : new Uint8Array(event.data);
    const resolve = waiting.shift();
    if (resolve) resolve(value);
    else queue.push(value);
  });
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (e) => resolve(e.code)),
  );
  const next = () => {
    const value = queue.shift();
    return value !== undefined
      ? Promise.resolve(value)
      : new Promise<string | Uint8Array>((r) => waiting.push(r));
  };
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({ socket, next, closed }));
    socket.addEventListener("error", () => reject(new Error("connection refused")));
  });
}
