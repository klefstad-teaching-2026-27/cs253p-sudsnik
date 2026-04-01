import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@sudsnik/infra-db";
import type { WasherRecord } from "../../domain/washer.js";
import type { WasherRepo } from "../../ports/washerRepo.js";
import { washers } from "./schema.js";

type Row = typeof washers.$inferSelect;

export function toRecord(r: Row): WasherRecord {
  return {
    washerId: r.washerId,
    nodeId: r.nodeId,
    idx: r.idx,
    firmware: r.firmware,
    state: r.state,
    maintenance: r.maintenance,
    ...(r.holdId ? { holdId: r.holdId } : {}),
    ...(r.faultedAt === null ? {} : { faultedAt: r.faultedAt }),
  };
}

/** Writes shared by every SQLite-backed inventory; the reads differ per variant. */
export function washerWrites(db: Db): Pick<WasherRepo, "reserve" | "markHeld" | "free" | "startWashing" | "fault" | "restoreFaulted" | "setMaintenance"> {
  return {
    reserve: (washerId, holdId) =>
      db.orm
        .update(washers)
        .set({ state: "held", holdId })
        .where(and(eq(washers.washerId, washerId), eq(washers.state, "idle"), eq(washers.maintenance, false)))
        .run().changes === 1,
    markHeld: (washerId, holdId) => void db.orm.update(washers).set({ state: "held", holdId }).where(eq(washers.washerId, washerId)).run(),
    free: (washerId, holdId) =>
      void db.orm
        .update(washers)
        .set({ state: "idle", holdId: null })
        .where(and(eq(washers.washerId, washerId), eq(washers.holdId, holdId)))
        .run(),
    startWashing: (washerId) => void db.orm.update(washers).set({ state: "washing" }).where(eq(washers.washerId, washerId)).run(),
    fault: (washerId, nowMs) => void db.orm.update(washers).set({ state: "faulted", holdId: null, faultedAt: nowMs }).where(eq(washers.washerId, washerId)).run(),
    restoreFaulted: (beforeMs) =>
      void db.orm
        .update(washers)
        .set({ state: "idle", faultedAt: null })
        .where(and(eq(washers.state, "faulted"), lte(washers.faultedAt, beforeMs)))
        .run(),
    setMaintenance: (washerId) => void db.orm.update(washers).set({ maintenance: true }).where(eq(washers.washerId, washerId)).run(),
  };
}

/** One indexed statement per read. */
export function sqliteWasherRepo(db: Db): WasherRepo {
  return {
    ...washerWrites(db),
    listByNode: (nodeId) => db.orm.select().from(washers).where(eq(washers.nodeId, nodeId)).orderBy(washers.idx).all().map(toRecord),
    get: (washerId) => {
      const row = db.orm.select().from(washers).where(eq(washers.washerId, washerId)).get();
      return row ? toRecord(row) : undefined;
    },
    pickIdle: (nodeId) => {
      const row = db.orm
        .select()
        .from(washers)
        .where(and(eq(washers.nodeId, nodeId), eq(washers.state, "idle"), eq(washers.maintenance, false)))
        .orderBy(washers.idx)
        .limit(1)
        .get();
      return row ? toRecord(row) : undefined;
    },
  };
}
