import { NODES, type NodeId } from "@sudsnik/contracts";
import type { z } from "zod";
import type { Washer as WasherSchema } from "@sudsnik/contracts/services/washnodes";

export type Washer = z.infer<typeof WasherSchema>;

export type Firmware = "v1" | "v2";
export type WasherState = "idle" | "held" | "washing" | "faulted";

export interface WasherRecord {
  washerId: string;
  nodeId: string;
  /** Index within the node, from canon's `washerId(node, i)`. */
  idx: number;
  firmware: Firmware;
  state: WasherState;
  maintenance: boolean;
  holdId?: string;
  faultedAt?: number;
}

/** A faulted washer returns to service after this long; a maintenance flag never lifts by itself. */
export const FAULT_COOLDOWN_MS = 5 * 60_000;

export function isNodeId(s: string): s is NodeId {
  return (NODES as readonly string[]).includes(s);
}

export function canHold(w: WasherRecord): boolean {
  return w.state === "idle" && !w.maintenance;
}

/** The washer as the port reports it: maintenance outranks whatever the washer is doing. */
export function washerView(w: WasherRecord): Washer {
  return {
    washerId: w.washerId,
    nodeId: w.nodeId,
    firmware: w.firmware,
    state: w.maintenance ? "maintenance" : w.state,
    ...(w.holdId ? { holdId: w.holdId } : {}),
  };
}
