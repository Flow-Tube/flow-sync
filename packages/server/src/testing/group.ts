import {
  buildEntry,
  concat,
  epochDraft,
  fromB64,
  fromHex,
  type MemberSecrets,
  memberSecrets,
  memberSubject,
  randomBytes,
  recoveryKeys,
  sign,
  tag,
  toB64,
  toHex,
  wrapEpochKey,
} from "@flow-sync/protocol";
import { ADMIN_TOKEN, postJson } from "./http.ts";

export const newDevice = () => memberSecrets(randomBytes(32), randomBytes(32));

/** A fresh group with one device and a recovery key, ready to claim an instance. */
export async function genesis() {
  const group = randomBytes(16);
  const device = newDevice();
  const recovery = recoveryKeys(randomBytes(32));
  const epochKey = randomBytes(32);
  const entry = buildEntry(
    group,
    undefined,
    {
      op: "genesis",
      signer: toHex(device.did),
      add: [memberSubject(device, "device"), memberSubject(recovery, "recovery")],
      epoch: epochDraft(epochKey, group, 0, [device, recovery]),
    },
    [device, recovery],
  );
  const wraps: Record<string, string> = {};
  for (const member of [device, recovery]) {
    wraps[toHex(member.did)] = toB64(
      await wrapEpochKey(member.kemPublic, group, 0, member.did, epochKey),
    );
  }
  return { group, device, recovery, epochKey, entry, wraps };
}

export type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

/** Claims the instance for a fresh group and returns that group's keys. */
export async function claim(app: App) {
  const fixture = await genesis();
  const res = await app.request(
    "/v1/claim",
    postJson({ entry: fixture.entry, wraps: fixture.wraps }, ADMIN_TOKEN),
  );
  if (res.status !== 201) throw new Error(`claim failed: ${res.status}`);
  return fixture;
}

/** Runs the challenge and token exchange the way a device does. */
export async function signIn(app: App, member: MemberSecrets, group: Uint8Array): Promise<string> {
  const did = toHex(member.did);
  const res = await app.request("/v1/auth/challenge", postJson({ did }));
  const { challenge, instance } = (await res.json()) as { challenge: string; instance: string };
  const message = concat(tag("auth"), fromHex(instance), group, fromB64(challenge));
  const signature = toB64(sign(member.sigSeed, message));
  const tokenRes = await app.request(
    "/v1/auth/token",
    postJson({ did, challenge, sig: signature }),
  );
  return ((await tokenRes.json()) as { token: string }).token;
}
