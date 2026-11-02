export type ErrorCode =
  | "length"
  | "range"
  | "magic"
  | "suite"
  | "group"
  | "sender"
  | "signature"
  | "replay"
  | "gap"
  | "prev"
  | "commitment"
  | "decrypt"
  | "payload"
  | "blob-hash"
  | "key-commitment"
  | "x25519"
  | "roster-format"
  | "roster-chain"
  | "roster-op"
  | "roster-signer"
  | "roster-signature"
  | "roster-key"
  | "roster-epoch"
  | "roster-meta";

export class FlowSyncError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.name = "FlowSyncError";
    this.code = code;
  }
}

export function fail(code: ErrorCode): never {
  throw new FlowSyncError(code);
}
