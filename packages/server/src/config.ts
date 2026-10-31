import { sha256, utf8 } from "@flow-sync/protocol";
import { z } from "zod";

const GiB = 1024 ** 3;

const envSchema = z.object({
  FLOW_SYNC_ADMIN_TOKEN: z.string().min(32).optional(),
  FLOW_SYNC_ADMIN: z.enum(["on", "off"]).default("on"),
  FLOW_SYNC_QUOTA: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * GiB),
  FLOW_SYNC_SECURITY_CONTACT: z.string().min(1).optional(),
  FLOW_SYNC_SECURITY_EXPIRES: z.iso.datetime().optional(),
});

export interface Config {
  /** SHA-256 of the admin token; undefined when admin access is off or unset. */
  adminTokenHash: Uint8Array | undefined;
  quota: number;
  live: boolean;
  securityTxt: { contact: string; expires: string } | undefined;
}

/** `FLOW_SYNC_ADMIN_TOKEN_FILE` is resolved by the entry, which knows how to read files. */
export function loadConfig(env: Record<string, unknown>, live: boolean): Config {
  const parsed = envSchema.parse(env);
  const token = parsed.FLOW_SYNC_ADMIN === "on" ? parsed.FLOW_SYNC_ADMIN_TOKEN : undefined;
  const { FLOW_SYNC_SECURITY_CONTACT: contact, FLOW_SYNC_SECURITY_EXPIRES: expires } = parsed;
  return {
    adminTokenHash: token ? sha256(utf8(token)) : undefined,
    quota: parsed.FLOW_SYNC_QUOTA,
    live,
    securityTxt: contact && expires ? { contact, expires } : undefined,
  };
}
