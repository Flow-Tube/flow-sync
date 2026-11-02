import type { ErrorCode } from "./http/errors.ts";

/** Per-request values shared between middleware and routes. */
export interface AppEnv {
  Variables: {
    errorCode: ErrorCode;
    /** The class of an unexpected error, never its message, which may hold input. */
    errorName: string;
    /** The authenticated member, set by requireMember. */
    did: string;
    /** When the member's token expires. */
    tokenExpires: number;
  };
}
