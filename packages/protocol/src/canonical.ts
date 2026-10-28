export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** FLOW-SYNC canonical JSON: sorted keys, no whitespace, integers only. */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] as Json)}`);
    return `{${fields.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("canonical JSON allows safe integers only");
  }
  return JSON.stringify(value);
}
