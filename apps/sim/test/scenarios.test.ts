import { BAND_IDS, FaultScheduleSchema, INVARIANT_IDS, SCENARIOS } from "@sudsnik/contracts";
import { describe, expect, it } from "vitest";
import { knownFaultsUrl, loadFaultSchedule } from "../src/faults/schedule.js";
import { scenarios } from "../src/scenarios/index.js";

describe("scenarios", () => {
  it("defines every scenario with valid invariants, bands, and fault schedules", () => {
    for (const name of SCENARIOS) {
      const s = scenarios[name];
      expect(s.name).toBe(name);
      expect(s.orbits).toBeGreaterThan(0);
      for (const inv of s.invariants) expect(INVARIANT_IDS).toContain(inv);
      for (const band of s.bands) expect(BAND_IDS).toContain(band);
      expect(FaultScheduleSchema.parse(s.faults)).toEqual(s.faults);
      expect(loadFaultSchedule(knownFaultsUrl(name))).toEqual(s.faults);
    }
  });

  it("matches the system-spec §10 table", () => {
    expect(scenarios["quiet-orbit"].ordersPerOrbit(1)).toBe(40);
    expect(scenarios["quiet-orbit"].faults.events.map((e) => [e.mock, e.kind, e.params.rate])).toEqual([
      ["payments", "timeout-rate", 0.02],
      ["payments", "duplicate-webhook-rate", 0.05],
    ]);
    expect(scenarios["dark-side"].faults.events).toEqual([
      { atOrbit: 0, mock: "washer-v1", kind: "hold-drop-rate", params: { rate: 0.05 } },
      { atOrbit: 4, orbits: 1, mock: "relay", kind: "dark", params: { kind: "node", id: "B" } },
      { atOrbit: 7, orbits: 1, mock: "relay", kind: "dark", params: { kind: "node", id: "A" } },
    ]);
    expect(scenarios["laundry-day"].ordersPerOrbit(5)).toBe(200);
    expect(scenarios["laundry-day"].scaleFromOrbit).toBe(2);
    expect(scenarios["laundry-day"].faults.events).toEqual([{ atOrbit: 0, mock: "ephemeris", kind: "quota", params: { callsPerOrbit: 100 } }]);
    expect(scenarios.storm.faults.events).toEqual([]);
    expect(scenarios["hostile-notes"].reports).toEqual({ rate: 0.3, hostileShare: 0.3 });
    expect(scenarios.migration.v2Share).toBe(0.5);
    expect(scenarios.migration.faults.events).toEqual([]);
  });
});
