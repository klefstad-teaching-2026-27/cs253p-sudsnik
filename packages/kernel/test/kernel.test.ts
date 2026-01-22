import { describe, expect, it } from "vitest";
import { ERROR_CODES, Rng, SimClock, err, httpStatus, isUlid, newId, ok, subSeed, sudsnikError, unwrap } from "../src/index.js";

describe("Result", () => {
  it("unwraps ok and throws on err", () => {
    expect(unwrap(ok(3))).toBe(3);
    expect(() => unwrap(err(sudsnikError("NOT_FOUND", "gone")))).toThrow("gone");
  });
});

describe("errors", () => {
  it("maps every code to an HTTP status and marks retryable ones", () => {
    expect(httpStatus("QUOTA")).toBe(429);
    expect(Object.keys(ERROR_CODES)).toHaveLength(9);
    expect(sudsnikError("TIMEOUT", "t").retryable).toBe(true);
    expect(sudsnikError("INVALID", "i").retryable).toBe(false);
  });
});

describe("SimClock", () => {
  it("starts at zero and resolves after() at tick granularity", async () => {
    const c = new SimClock();
    expect(c.now()).toBe(0);
    let done = false;
    void c.after(2000).then(() => (done = true));
    c.advanceTo(1000);
    await Promise.resolve();
    expect(done).toBe(false);
    c.advanceTo(60_000);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("fires every() once per elapsed period and stops", () => {
    const c = new SimClock();
    let n = 0;
    const stop = c.every(60_000, () => n++);
    c.advanceTo(60_000);
    c.advanceTo(180_000);
    expect(n).toBe(3);
    stop();
    c.advanceTo(600_000);
    expect(n).toBe(3);
  });

  it("ignores a tick into the past", () => {
    const c = new SimClock();
    c.advanceTo(100);
    c.advanceTo(50);
    expect(c.now()).toBe(100);
  });

  it("gives every repeater its tick even when one of them throws", () => {
    const c = new SimClock();
    const fired: string[] = [];
    c.every(10, () => {
      fired.push("first");
      throw new Error("boom");
    });
    c.every(10, () => void fired.push("second"));
    expect(() => c.advanceTo(10)).toThrow("boom");
    expect(fired).toEqual(["first", "second"]);
  });
});

describe("ids and seeds", () => {
  it("makes ULIDs", () => {
    expect(isUlid(newId())).toBe(true);
    expect(isUlid("nope")).toBe(false);
  });
  it("derives sub-seeds deterministically", () => {
    expect(subSeed("00000000c0ffee00", "payments")).toMatch(/^[0-9a-f]{16}$/);
    expect(subSeed("00000000c0ffee00", "payments")).toBe(subSeed("00000000c0ffee00", "payments"));
    expect(subSeed("00000000c0ffee00", "payments")).not.toBe(subSeed("00000000c0ffee00", "relay"));
  });
  it("PRNG is deterministic and in range", () => {
    const a = new Rng("00000000c0ffee00");
    const b = new Rng("00000000c0ffee00");
    const xs = Array.from({ length: 100 }, () => a.float());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b.float()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(() => new Rng("bad")).toThrow();
  });
});
