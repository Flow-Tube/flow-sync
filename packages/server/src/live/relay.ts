import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import type { Group } from "../group.ts";

/** How the app reaches its host's live relay. */
export interface LiveRelay {
  /** Answers an authenticated upgrade request on /v1/live. */
  upgrade: MiddlewareHandler<AppEnv>;
  changed: Stored;
}

/** Tells the group's other connected devices that [did] stored something new, so they sync now. */
export type Stored = (did: string) => void | Promise<void>;

export type LiveFactory<L extends LiveRelay> = (group: Group, now: () => number) => L;
