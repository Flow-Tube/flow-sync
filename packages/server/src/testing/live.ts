import type { AddressInfo } from "node:net";
import { LIVE_PROTOCOL } from "../routes/live.ts";
import { listen } from "../runtime/node.ts";
import type { testApp } from "./app.ts";
import { type LiveClient, track } from "./socket.ts";

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

export function connect(port: number, token: string): Promise<LiveClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/live`, [
    LIVE_PROTOCOL,
    `bearer.${token}`,
  ]);
  socket.binaryType = "arraybuffer";
  sockets.push(socket);
  const client = track(socket);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(client));
    socket.addEventListener("error", () => reject(new Error("connection refused")));
  });
}
