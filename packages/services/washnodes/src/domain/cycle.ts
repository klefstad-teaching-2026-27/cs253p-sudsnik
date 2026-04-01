import { CYCLE_ATTEMPTS_PER_ORDER } from "@sudsnik/contracts";
import type { Firmware } from "./washer.js";

export type CycleOutcome = { state: "running" } | { state: "completed"; cycleUnits: number } | { state: "faulted"; faultCode: string };

export interface CycleRecord {
  cycleId: string;
  tenantId: string;
  correlationId: string;
  holdId: string;
  orderId: string;
  /** Known when the cycle was started by pod.delivered; the HTTP port's startCycle has no pod to name. */
  podId?: string;
  nodeId: string;
  washerId: string;
  firmware: Firmware;
  attempt: number;
  state: "running" | "completed" | "faulted";
  startedAt: number;
  endedAt?: number;
  cycleUnits?: number;
  faultCode?: string;
  retryPending: boolean;
}

/** v1 completion is observed by polling status this often. */
export const V1_POLL_MS = 5 * 60_000;
/** A v2 cycle whose callback has not arrived this long after start is read back from the firmware. */
export const V2_RECONCILE_AFTER_MS = 60 * 60_000;

export function isFinalAttempt(attempt: number): boolean {
  return attempt >= CYCLE_ATTEMPTS_PER_ORDER;
}
