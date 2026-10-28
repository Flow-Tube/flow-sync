const pad = (value: number | bigint, digits: number) => value.toString(16).padStart(digits, "0");

export function rosterPath(seq: number, hash: string): string {
  return `roster/${pad(seq, 16)}-${hash.slice(0, 16)}.r`;
}

export function wrapPath(epoch: number, did: string): string {
  return `keys/${pad(epoch, 8)}/${did}.k`;
}

export function chainPath(epoch: number): string {
  return `keys/${pad(epoch, 8)}/chain.k`;
}

export function logPath(did: string, seq: number): string {
  return `dev/${did}/log/${pad(BigInt(seq) >> 10n, 16)}/${pad(seq, 16)}.o`;
}

export function blobPath(did: string, hash: string): string {
  return `dev/${did}/blob/${hash}.b`;
}

export function pairPath(slot: string, direction: "a" | "b", seq: number): string {
  return `pair/${slot}/${direction}-${pad(seq, 16)}.p`;
}

export type DevicePath =
  | { kind: "log"; did: string; seq: number }
  | { kind: "blob"; did: string; hash: string };

const LOG = /^dev\/([0-9a-f]{32})\/log\/([0-9a-f]{16})\/([0-9a-f]{16})\.o$/;
const BLOB = /^dev\/([0-9a-f]{32})\/blob\/([0-9a-f]{64})\.b$/;

/** Parses a path under dev/, or returns undefined when it isn't a valid one. */
export function parseDevicePath(path: string): DevicePath | undefined {
  const log = LOG.exec(path);
  if (log) {
    const [, did, shard, seqHex] = log as unknown as [string, string, string, string];
    const seq = BigInt(`0x${seqHex}`);
    if (seq > BigInt(Number.MAX_SAFE_INTEGER) || pad(seq >> 10n, 16) !== shard) return undefined;
    return { kind: "log", did, seq: Number(seq) };
  }
  const blob = BLOB.exec(path);
  if (blob) return { kind: "blob", did: blob[1] as string, hash: blob[2] as string };
  return undefined;
}
