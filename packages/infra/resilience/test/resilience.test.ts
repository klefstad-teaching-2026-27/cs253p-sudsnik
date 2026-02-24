import { describe, expect, it } from "vitest";
import { SimClock, err, ok, sudsnikError } from "@sudsnik/kernel";
import { createBreaker, retry, withTimeout } from "../src/index.js";

describe("retry", () => {
  it("retries retryable failures with backoff on the clock and stops at attempts", async () => {
    const clock = new SimClock();
    let calls = 0;
    const p = retry(async () => (++calls < 3 ? err(sudsnikError("UNAVAILABLE", "x")) : ok(calls)), { attempts: 5, baseMs: 100, clock });
    for (let t = 100; t <= 1000; t += 100) {
      await Promise.resolve();
      clock.advanceTo(t);
    }
    expect(await p).toEqual({ ok: true, value: 3 });
  });
  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    const r = await retry(async () => (calls++, err(sudsnikError("INVALID", "bad"))), { attempts: 3, baseMs: 1, clock: new SimClock() });
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
  });
});

describe("withTimeout", () => {
  it("fails TIMEOUT when the clock passes the deadline first", async () => {
    const clock = new SimClock();
    const never = new Promise<never>(() => {});
    const p = withTimeout(never, 2000, clock, "payments");
    clock.advanceTo(60_000);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TIMEOUT");
  });
});

describe("breaker", () => {
  it("opens after the threshold, rejects while open, half-opens after openMs, closes on success", async () => {
    const clock = new SimClock();
    const changes: string[] = [];
    const b = createBreaker({ failureThreshold: 2, openMs: 1000, clock, name: "eph", onStateChange: (f, t) => changes.push(`${f}>${t}`) });
    const fail = () => Promise.resolve(err(sudsnikError("QUOTA", "429")));
    await b.exec(fail);
    await b.exec(fail);
    expect(b.state()).toBe("open");
    let calls = 0;
    const r = await b.exec(async () => (calls++, ok(1)));
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
    clock.advanceTo(1000);
    expect((await b.exec(async () => ok(1))).ok).toBe(true);
    expect(b.state()).toBe("closed");
    expect(changes).toEqual(["closed>open", "open>half-open", "half-open>closed"]);
  });

  it("releases the half-open trial when the call throws instead of answering", async () => {
    const clock = new SimClock();
    const b = createBreaker({ failureThreshold: 1, openMs: 1000, clock, name: "eph" });
    await b.exec(() => Promise.resolve(err(sudsnikError("QUOTA", "429"))));
    expect(b.state()).toBe("open");
    clock.advanceTo(1000);
    await expect(b.exec(() => Promise.reject(new Error("socket closed")))).rejects.toThrow("socket closed");
    // Without the release the trial would still be in flight and every later call would be refused unattempted.
    expect((await b.exec(async () => ok(1))).ok).toBe(true);
    expect(b.state()).toBe("closed");
  });
});
