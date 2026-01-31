import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { Hold, NodeStatus } from "./routes.js";

export interface WashnodesService {
  acquireHold(nodeId: string, orderId: string, ctx: Ctx): Promise<Result<Hold>>;
  releaseHold(holdId: string, reason: string, ctx: Ctx): Promise<Result<Hold>>;
  startCycle(holdId: string, ctx: Ctx): Promise<Result<{ cycleId: string; washerId: string; startedAt: number }>>;
  status(nodeId: string, ctx: Ctx): Promise<Result<NodeStatus>>;
}

/** Durable hold storage with optimistic concurrency. */
export interface HoldStore {
  acquire(input: { nodeId: string; washerId: string; orderId: string; tenantId: string; nowMs: number; ttlMs: number; firmwareRef?: string }): Promise<Result<Hold>>;
  release(holdId: string, expectedVersion: number, reason: string, nowMs: number): Promise<Result<Hold>>;
  /** Marks a held hold consumed when its cycle starts; CONFLICT when the version or state does not match. */
  consume(holdId: string, expectedVersion: number, nowMs: number): Promise<Result<Hold>>;
  expire(nowMs: number): Promise<Result<Hold[]>>;
  get(holdId: string): Promise<Result<Hold>>;
}
