import type { CycleOutcome, CycleRecord } from "../domain/cycle.js";
import type { Firmware } from "../domain/washer.js";

export interface CycleRepo {
  insert(cycle: CycleRecord): void;
  get(cycleId: string): CycleRecord | undefined;
  byHold(holdId: string): CycleRecord | undefined;
  latestForOrder(orderId: string): CycleRecord | undefined;
  attemptsFor(orderId: string): number;
  running(firmware: Firmware, startedBeforeMs: number): CycleRecord[];
  /** Records the outcome once; false when the cycle was no longer running. */
  finish(cycleId: string, outcome: Exclude<CycleOutcome, { state: "running" }>, endedAt: number): boolean;
  setRetryPending(cycleId: string, pending: boolean): void;
  pendingRetries(): CycleRecord[];
}
