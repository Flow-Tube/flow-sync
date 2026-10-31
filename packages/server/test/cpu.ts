import { randomBytes, toB64 } from "@flow-sync/protocol";
import { Group } from "../src/group.ts";
import { claimedApp } from "../src/testing/app.ts";
import { signIn } from "../src/testing/group.ts";
import { objectUrl, putBytes, sealedObject } from "../src/testing/objects.ts";
import { addDevice } from "../src/testing/roster.ts";

// Workers Free allows 10 ms of CPU per request. Each case runs through the whole app on an
// in-memory database, so the time measured is CPU: crypto, parsing and the router.
const RUNS = 20;
const WARMUP = 5;
const KiB = 1024;
const rows: Record<string, string>[] = [];

async function measure(name: string, run: (i: number) => Promise<unknown>) {
  const first = performance.now();
  await run(0);
  const cold = performance.now() - first;
  for (let i = 1; i <= WARMUP; i++) await run(i);
  const times: number[] = [];
  for (let i = WARMUP + 1; i <= WARMUP + RUNS; i++) {
    const start = performance.now();
    await run(i);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const ms = (value: number) => value.toFixed(2);
  const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
  rows.push({
    case: name,
    "first ms": ms(cold),
    "mean ms": ms(mean),
    "p95 ms": ms(times[Math.floor(times.length * 0.95)] ?? 0),
    "max ms": ms(times.at(-1) ?? 0),
  });
}

/** randomBytes gives at most 64 KiB per call. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 64 * KiB)
    out.set(randomBytes(Math.min(64 * KiB, length - i)), i);
  return out;
}

const h = await claimedApp();
const token = await signIn(h.app, h.device, h.group);

await measure("token issue (challenge + token)", () => signIn(h.app, h.device, h.group));

let seq = 1;
for (const size of [1, 64, 1024, 2048, 3584].map((k) => k * KiB)) {
  // Random base64 barely compresses, so the sealed object ends up close to `size`.
  const content = toB64(noise(Math.floor(size * 0.75)));
  const sealed = Array.from({ length: 1 + WARMUP + RUNS }, () => {
    const s = seq++;
    return {
      s,
      bytes: sealedObject(h.device, s, { group: h.group, epochKey: h.epochKey, content }),
    };
  });
  const label = `object PUT ${Math.round((sealed[0]?.bytes.length ?? 0) / KiB)} KiB`;
  await measure(label, async (i) => {
    const { s, bytes } = sealed[i] as { s: number; bytes: Uint8Array };
    const res = await h.app.request(objectUrl(h.device, s), putBytes(token, bytes));
    if (res.status !== 201) throw new Error(`PUT ${res.status}`);
  });
}

for (const devices of [1, 10, 30]) {
  const roster = await claimedApp();
  const rosterToken = await signIn(roster.app, roster.device, roster.group);
  for (let i = 1; i < devices; i++) await addDevice(roster, rosterToken);
  await measure(`roster replay, ${devices} devices`, () => new Group(roster.storage.meta).roster());
}

console.table(rows);
