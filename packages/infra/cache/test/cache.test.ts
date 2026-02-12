import { describe, expect, it } from "vitest";
import { SimClock } from "@sudsnik/kernel";
import { FakeMeter } from "@sudsnik/contracts/testing";
import { createCache } from "../src/index.js";

describe("cache", () => {
  it("expires on the simulated clock, evicts LRU, and meters", () => {
    const clock = new SimClock();
    const meter = new FakeMeter();
    const c = createCache<number>({ max: 2, ttlMs: 1000, clock, meter, service: "t" });
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    clock.advanceTo(1000);
    expect(c.get("a")).toBeUndefined();
    expect(c.stats()).toEqual({ hits: 2, misses: 2, evictions: 1 });
    expect(meter.byOperation.CACHE_WRITE?.count).toBe(3);
    expect(meter.byOperation.CACHE_READ?.count).toBe(4);
  });
  it("rejects max < 1", () => {
    expect(() => createCache({ max: 0, ttlMs: 1, clock: new SimClock(), meter: new FakeMeter(), service: "t" })).toThrow();
  });
});
