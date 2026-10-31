import type { Env as WorkerEnv } from "../entry/workers.ts";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
