import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildVectors, serialize, VECTORS_DIR } from "./generate.ts";

test("spec/vectors match a fresh generation byte for byte", async () => {
  for (const [name, vectors] of Object.entries(await buildVectors())) {
    const committed = readFileSync(new URL(`${name}.json`, VECTORS_DIR), "utf8");
    expect(serialize(vectors), name).toBe(committed);
  }
});
