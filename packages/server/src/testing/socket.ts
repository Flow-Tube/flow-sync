export interface LiveClient {
  socket: WebSocket;
  next(): Promise<string | Uint8Array>;
  closed: Promise<number>;
}

/** Queues a socket's messages so a test can await them in order. */
export function track(socket: WebSocket): LiveClient {
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
  return { socket, next, closed };
}
