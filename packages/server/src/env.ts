import type { ErrorCode } from "./http/errors.ts";

/** Per-request values shared between middleware and routes. */
export interface AppEnv {
  Variables: {
    errorCode: ErrorCode;
    /** The authenticated member, set by requireMember. */
    did: string;
  };
}
