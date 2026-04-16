import { HABITATS, MINUTE_MS, MOCKS, isHabitatVisible, type ClockTick, type Envelope, type FaultEvent, type MockName, type SimState } from "@sudsnik/contracts";
import { describe, expect, it } from "vitest";
import { createTicker } from "../src/clock.js";

describe("ticker", () => {
  it("publishes clock.tick, posts /_sim/state to every mock with its faults and the dark ids, then steps the world", async () => {
    const published: Envelope<ClockTick>[] = [];
    const states: Array<{ mock: MockName; state: SimState }> = [];
    const steps: Array<{ tick: ClockTick; dark: string[] }> = [];
    const fault: FaultEvent = { atOrbit: 0, mock: "payments", kind: "timeout-rate", params: { rate: 0.02 } };
    const ticker = createTicker({
      publish: async (e) => void published.push(e),
      postState: async (mock, state) => {
        if (mock === "oracle") throw new Error("down");
        states.push({ mock, state });
      },
      faultsAt: () => [fault, { atOrbit: 0, orbits: 1, mock: "relay", kind: "dark", params: { kind: "node", id: "B" } }],
      onStep: async (tick, dark) => void steps.push({ tick, dark }),
      clockRate: 600,
    });
    expect(ticker.now()).toBe(0);
    const first = await ticker.tick();
    const second = await ticker.tick();
    expect(first).toEqual({ nowMs: 0, orbit: 0, orbitPhase: 0 });
    expect(second.nowMs).toBe(MINUTE_MS);
    expect(published.map((e) => e.payload.nowMs)).toEqual([0, MINUTE_MS]);
    expect(published[0]).toMatchObject({ topic: "clock.tick", tenantId: "system" });
    expect(states.filter((s) => s.mock === "payments")[0]!.state).toMatchObject({ clockMs: 0, orbit: 0, faults: [fault] });
    expect(states.filter((s) => s.mock === "relay")[0]!.state.faults[0]!.kind).toBe("dark");
    expect(states.filter((s) => s.mock === "ephemeris")[0]!.state.faults).toEqual([]);
    expect(states.filter((s) => s.state.clockMs === 0)).toHaveLength(MOCKS.length - 1);
    const dark = states[0]!.state.dark;
    // The windows overlap by 2.5 minutes, and the last habitat's wraps the orbit, so two are in contact at orbit start.
    expect(dark).not.toContain("hab01");
    expect(dark).not.toContain("hab12");
    expect(dark).toContain("hab02");
    expect(dark).toContain("B");
    expect(dark.filter((d) => HABITATS.includes(d))).toEqual(HABITATS.filter((h) => !isHabitatVisible(h, 0)));
    expect(steps).toHaveLength(2);
    expect(steps[0]!.dark).toEqual(dark);
    expect(ticker.stateFailures()).toEqual({ oracle: 2 });
    expect(ticker.running()).toBe(false);
  });

  it("ticks on the wall clock at 60_000 / rate ms until stopped", async () => {
    let n = 0;
    const ticker = createTicker({ publish: async () => undefined, postState: async () => undefined, faultsAt: () => [], onStep: async () => void n++, clockRate: 60_000 });
    ticker.start();
    expect(ticker.running()).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    ticker.stop();
    const seen = n;
    expect(seen).toBeGreaterThanOrEqual(3);
    await new Promise((r) => setTimeout(r, 10));
    expect(n).toBe(seen);
  });
});
