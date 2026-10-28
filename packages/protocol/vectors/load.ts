import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { FlowSyncError, fromHex } from "../src/index.ts";

// biome-ignore lint/suspicious/noExplicitAny: vector files are untyped JSON read the way an app would.
export function load(name: string): any {
  return JSON.parse(
    readFileSync(new URL(`../../../spec/vectors/${name}.json`, import.meta.url), "utf8"),
  );
}

export const bytes = fromHex;

export async function expectCode(run: () => unknown, code: string): Promise<void> {
  const error = await Promise.resolve()
    .then(run)
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(error).toBeInstanceOf(FlowSyncError);
  expect((error as FlowSyncError).code).toBe(code);
}
