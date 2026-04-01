import type { WasherRecord } from "../domain/washer.js";

/** The washer inventory; the only writer of a washer's state. Synchronous because SQLite is. */
export interface WasherRepo {
  listByNode(nodeId: string): WasherRecord[];
  get(washerId: string): WasherRecord | undefined;
  pickIdle(nodeId: string): WasherRecord | undefined;
  /** idle -> held only if still idle; false when another hold got there first. */
  reserve(washerId: string, holdId: string): boolean;
  /** -> held without looking; the starter's store trusts its caller's pick. */
  markHeld(washerId: string, holdId: string): void;
  /** -> idle, only while the washer still carries this hold. */
  free(washerId: string, holdId: string): void;
  startWashing(washerId: string): void;
  fault(washerId: string, nowMs: number): void;
  restoreFaulted(beforeMs: number): void;
  setMaintenance(washerId: string): void;
}
