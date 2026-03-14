import { HOLD_TTL_MS, NODES, NODE_FIRMWARE, WASHERS_PER_NODE, WASH_CYCLE_MS, washerId, type NodeId } from "@sudsnik/contracts";
import type { Mock } from "./mock.js";

export interface Cycle {
  cycleId: string;
  washerId: string;
  startedAtMs: number;
  endsAtMs: number;
  /** Decided when the cycle starts; visible once `endsAtMs` has passed. */
  outcome: { state: "completed"; cycleUnits: number } | { state: "faulted"; faultCode: string };
}

export interface Hold {
  holdId: string;
  washerId: string;
  expiresAtMs: number;
}

export interface Washer {
  washerId: string;
  node: NodeId;
  hold?: Hold;
  cycle?: Cycle;
}

export const FAULT_CODES = ["E11_DRUM_STALL", "E23_WATER_LOW", "E37_HEATER", "E42_SENSOR_CRC", "E58_PUMP"] as const;

/** The washers of every node on the given firmware generation, keyed by washer id. */
export function washerFleet(firmware: "v1" | "v2"): Map<string, Washer> {
  const fleet = new Map<string, Washer>();
  for (const node of NODES) {
    if (NODE_FIRMWARE[node] !== firmware) continue;
    for (let i = 0; i < WASHERS_PER_NODE; i++) {
      const id = washerId(node, i);
      fleet.set(id, { washerId: id, node });
    }
  }
  return fleet;
}

export function activeHold(w: Washer, nowMs: number): Hold | undefined {
  return w.hold && w.hold.expiresAtMs > nowMs ? w.hold : undefined;
}

export function runningCycle(w: Washer, nowMs: number): Cycle | undefined {
  return w.cycle && w.cycle.endsAtMs > nowMs ? w.cycle : undefined;
}

export function isBusy(w: Washer, nowMs: number): boolean {
  return activeHold(w, nowMs) !== undefined || runningCycle(w, nowMs) !== undefined;
}

export function placeHold(mock: Mock, w: Washer, prefix: string): Hold {
  const hold: Hold = { holdId: mock.id(prefix), washerId: w.washerId, expiresAtMs: mock.nowMs() + HOLD_TTL_MS };
  w.hold = hold;
  return hold;
}

export function startCycle(mock: Mock, w: Washer, faultRate: number): Cycle {
  const rng = mock.rng("faults");
  const startedAtMs = mock.nowMs();
  const cycle: Cycle = {
    cycleId: mock.id("cyc"),
    washerId: w.washerId,
    startedAtMs,
    endsAtMs: startedAtMs + WASH_CYCLE_MS,
    outcome: rng.chance(faultRate)
      ? { state: "faulted", faultCode: rng.pick(FAULT_CODES) }
      : { state: "completed", cycleUnits: 20 + mock.rng("units").int(41) },
  };
  w.hold = undefined;
  w.cycle = cycle;
  return cycle;
}
