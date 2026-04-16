import { createHash } from "node:crypto";

/** JSON with object keys sorted at every depth, so equal values serialize identically whatever the insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** system-spec §10.3: first 8 hex characters of SHA-256 over the canonical JSON of the body without `checksum`. */
export function checksumOf(body: Record<string, unknown>): string {
  const { checksum: _omitted, ...rest } = body;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex").slice(0, 8);
}

export function checksumVerifies(body: Record<string, unknown>): boolean {
  return typeof body.checksum === "string" && body.checksum === checksumOf(body);
}
