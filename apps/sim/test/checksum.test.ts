import { describe, expect, it } from "vitest";
import { canonicalJson, checksumOf, checksumVerifies } from "../src/checksum.js";

describe("checksumOf", () => {
  it("is 8 hex characters, deterministic, and independent of key order and of any existing checksum", () => {
    const a = { kind: "collected", orderId: "o1", podId: "p1", shuttleId: "sh1", id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", atMs: 0 };
    const b = { atMs: 0, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", shuttleId: "sh1", podId: "p1", orderId: "o1", kind: "collected", checksum: "deadbeef" };
    expect(checksumOf(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(checksumOf(a)).toBe(checksumOf(b));
    expect(checksumOf({ ...a, atMs: 1 })).not.toBe(checksumOf(a));
  });

  it("verifies a body whose checksum was computed over it and rejects a flipped one", () => {
    const body = { kind: "position", shuttleId: "sh2", orbitPhase: 0.25, id: "x", atMs: 5 };
    const signed = { ...body, checksum: checksumOf(body) };
    expect(checksumVerifies(signed)).toBe(true);
    const flipped = signed.checksum[0] === "0" ? `f${signed.checksum.slice(1)}` : `0${signed.checksum.slice(1)}`;
    expect(checksumVerifies({ ...signed, checksum: flipped })).toBe(false);
    expect(checksumVerifies(body)).toBe(false);
  });

  it("canonicalizes nested objects and arrays, dropping undefined", () => {
    expect(canonicalJson({ b: [{ z: 1, a: undefined }], a: null })).toBe('{"a":null,"b":[{"z":1}]}');
  });
});
