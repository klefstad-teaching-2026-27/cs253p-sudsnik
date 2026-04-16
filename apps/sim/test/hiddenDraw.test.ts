import { FaultScheduleSchema } from "@sudsnik/contracts";
import { describe, expect, it } from "vitest";
import { hiddenStormDraw } from "../src/faults/hiddenDraw.js";

const ALLOWED = new Set(["relay:duplicate-rate", "relay:reorder-rate", "relay:bitflip-rate", "relay:dark", "identity:error-burst"]);

describe("storm draw", () => {
  it("always carries a duplicate or a bit-flip fault, since time to detect anchors on one", () => {
    for (let i = 0; i < 200; i++) {
      const seed = i.toString(16).padStart(16, "0");
      const kinds = hiddenStormDraw(seed).map((f) => f.kind);
      expect(kinds.some((k) => k === "duplicate-rate" || k === "bitflip-rate"), seed).toBe(true);
    }
  });
});

describe("hiddenStormDraw", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = hiddenStormDraw("00000000c0ffee00");
    expect(hiddenStormDraw("00000000c0ffee00")).toEqual(a);
    const seeds = ["0000000000000001", "0000000000000002", "0000000000000003", "deadbeefdeadbeef"];
    expect(seeds.some((s) => JSON.stringify(hiddenStormDraw(s)) !== JSON.stringify(a))).toBe(true);
  });

  it("draws three to five candidates from the §10 storm list at orbits inside the run", () => {
    for (const seed of ["00000000c0ffee00", "0123456789abcdef", "fedcba9876543210", "1111111111111111", "abcdefabcdefabcd"]) {
      const events = hiddenStormDraw(seed);
      expect(FaultScheduleSchema.parse({ events })).toBeTruthy();
      const kinds = events.map((e) => `${e.mock}:${e.kind}`);
      for (const k of kinds) expect(ALLOWED.has(k)).toBe(true);
      const darks = events.filter((e) => e.kind === "dark");
      const candidates = new Set(kinds).size;
      expect(candidates).toBeGreaterThanOrEqual(3);
      expect(candidates).toBeLessThanOrEqual(5);
      expect(darks.length === 0 || darks.length === 2).toBe(true);
      if (darks.length === 2) {
        expect(darks[0]!.atOrbit).not.toBe(darks[1]!.atOrbit);
        for (const d of darks) expect(d.params).toEqual({ kind: "node", id: "C" });
      }
      for (const e of events) {
        expect(e.atOrbit).toBeGreaterThanOrEqual(2);
        expect(e.atOrbit).toBeLessThan(12);
      }
      expect(events.map((e) => e.atOrbit)).toEqual([...events.map((e) => e.atOrbit)].sort((x, y) => x - y));
    }
  });
});
