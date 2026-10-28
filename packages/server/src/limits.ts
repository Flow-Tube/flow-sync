const KiB = 1024;
const MiB = 1024 * KiB;

/** The limits from spec/api.md; `/v1/info` publishes them. */
export const LIMITS = {
  jsonBody: 64 * KiB,
  object: 4 * MiB,
  rosterEntry: 16 * KiB,
  rosterPage: 500,
  changesPage: 1000,
  liveMessage: 64 * KiB,
  liveRate: 20,
  devicePerMinute: 600,
  ipPerMinute: 120,
  authFailures: 10,
  adminFailures: 5,
  banMs: 15 * 60 * 1000,
  challengeMs: 60 * 1000,
  tokenMs: 15 * 60 * 1000,
  pairMs: 180 * 1000,
  pairMessage: 8 * KiB,
  pairMessages: 8,
  pairSlots: 3,
} as const;
