import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@sudsnik/infra-db";
import type { CycleRecord } from "../../domain/cycle.js";
import type { CycleRepo } from "../../ports/cycleRepo.js";
import { cycles } from "./schema.js";

type Row = typeof cycles.$inferSelect;

function toRecord(r: Row): CycleRecord {
  return {
    cycleId: r.cycleId,
    tenantId: r.tenantId,
    correlationId: r.correlationId,
    holdId: r.holdId,
    orderId: r.orderId,
    nodeId: r.nodeId,
    washerId: r.washerId,
    firmware: r.firmware,
    attempt: r.attempt,
    state: r.state,
    startedAt: r.startedAt,
    retryPending: r.retryPending,
    ...(r.podId === null ? {} : { podId: r.podId }),
    ...(r.endedAt === null ? {} : { endedAt: r.endedAt }),
    ...(r.cycleUnits === null ? {} : { cycleUnits: r.cycleUnits }),
    ...(r.faultCode === null ? {} : { faultCode: r.faultCode }),
  };
}

export function sqliteCycleRepo(db: Db): CycleRepo {
  const one = (row: Row | undefined) => (row ? toRecord(row) : undefined);
  return {
    insert: (c) =>
      void db.orm
        .insert(cycles)
        .values({
          cycleId: c.cycleId,
          tenantId: c.tenantId,
          correlationId: c.correlationId,
          holdId: c.holdId,
          orderId: c.orderId,
          podId: c.podId ?? null,
          nodeId: c.nodeId,
          washerId: c.washerId,
          firmware: c.firmware,
          attempt: c.attempt,
          state: c.state,
          startedAt: c.startedAt,
          retryPending: c.retryPending,
        })
        .run(),
    get: (cycleId) => one(db.orm.select().from(cycles).where(eq(cycles.cycleId, cycleId)).get()),
    byHold: (holdId) => one(db.orm.select().from(cycles).where(eq(cycles.holdId, holdId)).get()),
    latestForOrder: (orderId) => one(db.orm.select().from(cycles).where(eq(cycles.orderId, orderId)).orderBy(desc(cycles.attempt)).limit(1).get()),
    attemptsFor: (orderId) => db.orm.select({ n: sql<number>`count(*)` }).from(cycles).where(eq(cycles.orderId, orderId)).get()?.n ?? 0,
    running: (firmware, startedBeforeMs) =>
      db.orm
        .select()
        .from(cycles)
        .where(and(eq(cycles.state, "running"), eq(cycles.firmware, firmware), lte(cycles.startedAt, startedBeforeMs)))
        .orderBy(cycles.startedAt)
        .all()
        .map(toRecord),
    finish: (cycleId, outcome, endedAt) =>
      db.orm
        .update(cycles)
        .set(outcome.state === "completed" ? { state: "completed", endedAt, cycleUnits: outcome.cycleUnits } : { state: "faulted", endedAt, faultCode: outcome.faultCode })
        .where(and(eq(cycles.cycleId, cycleId), eq(cycles.state, "running")))
        .run().changes === 1,
    setRetryPending: (cycleId, pending) => void db.orm.update(cycles).set({ retryPending: pending }).where(eq(cycles.cycleId, cycleId)).run(),
    pendingRetries: () => db.orm.select().from(cycles).where(eq(cycles.retryPending, true)).orderBy(cycles.endedAt).all().map(toRecord),
  };
}
