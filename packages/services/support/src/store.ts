import { and, eq, sql } from "drizzle-orm";
import type { Report, TriageResult } from "@sudsnik/contracts/services/support";
import type { Db } from "@sudsnik/infra-db";
import { evalFixtures, handledEvents, notificationFailures, ordersSeen, reports, tokenUsage, triageResults, type REPORT_STATES } from "./schema.js";

export type ReportState = (typeof REPORT_STATES)[number];
export type ReportRow = typeof reports.$inferSelect;
export type TriageRow = typeof triageResults.$inferSelect;
export type EvalFixtureRow = typeof evalFixtures.$inferSelect;

export interface Store {
  insertReport(row: ReportRow): void;
  report(tenantId: string, reportId: string): Report | undefined;
  setState(reportId: string, state: ReportState): void;
  /** Records a triage result and makes it the report's current one. */
  insertTriage(row: TriageRow, state: ReportState): void;
  /** Every triage of one report, oldest first. */
  triageHistory(reportId: string): TriageRow[];
  recordOrderReturned(row: typeof ordersSeen.$inferInsert): void;
  orderReturned(orderId: string): typeof ordersSeen.$inferSelect | undefined;
  recordNotificationFailure(row: typeof notificationFailures.$inferInsert): void;
  notificationFailure(notificationId: string): typeof notificationFailures.$inferSelect | undefined;
  /** True the first time an envelope id is seen; false on every redelivery. */
  markHandled(envelopeId: string, topic: string, now: number): boolean;
  tokensInOrbit(orbit: number): number;
  addTokens(orbit: number, tokens: number): void;
  upsertFixtures(rows: EvalFixtureRow[]): void;
  fixtures(): EvalFixtureRow[];
}

export function createStore(db: Db): Store {
  const { orm } = db;
  const triageOf = (row: ReportRow): TriageResult | undefined => {
    if (!row.triageId) return undefined;
    const t = orm.select().from(triageResults).where(eq(triageResults.triageId, row.triageId)).get();
    return t && { category: t.category, severity: t.severity as TriageResult["severity"], action: t.action as TriageResult["action"], tokens: t.tokens, guarded: t.guarded };
  };
  const toReport = (row: ReportRow): Report => {
    const triage = triageOf(row);
    return {
      reportId: row.reportId,
      tenantId: row.tenantId,
      orderId: row.orderId,
      podId: row.podId,
      note: row.note,
      receivedAt: row.receivedAt,
      state: row.state,
      ...(triage ? { triage } : {}),
    };
  };
  return {
    insertReport: (row) => void orm.insert(reports).values(row).run(),
    report(tenantId, reportId) {
      const row = orm.select().from(reports).where(and(eq(reports.tenantId, tenantId), eq(reports.reportId, reportId))).get();
      return row && toReport(row);
    },
    setState: (reportId, state) => void orm.update(reports).set({ state }).where(eq(reports.reportId, reportId)).run(),
    insertTriage(row, state) {
      orm.insert(triageResults).values(row).run();
      orm.update(reports).set({ triageId: row.triageId, state }).where(eq(reports.reportId, row.reportId)).run();
    },
    triageHistory: (reportId) => orm.select().from(triageResults).where(eq(triageResults.reportId, reportId)).orderBy(triageResults.triagedAt).all(),
    recordOrderReturned: (row) => void orm.insert(ordersSeen).values(row).onConflictDoNothing().run(),
    orderReturned: (orderId) => orm.select().from(ordersSeen).where(eq(ordersSeen.orderId, orderId)).get(),
    recordNotificationFailure: (row) => void orm.insert(notificationFailures).values(row).onConflictDoNothing().run(),
    notificationFailure: (id) => orm.select().from(notificationFailures).where(eq(notificationFailures.notificationId, id)).get(),
    markHandled: (envelopeId, topic, now) => orm.insert(handledEvents).values({ envelopeId, topic, handledAt: now }).onConflictDoNothing().run().changes === 1,
    tokensInOrbit: (orbit) => orm.select({ tokens: tokenUsage.tokens }).from(tokenUsage).where(eq(tokenUsage.orbit, orbit)).get()?.tokens ?? 0,
    addTokens(orbit, tokens) {
      db.lazy(() =>
        orm
          .insert(tokenUsage)
          .values({ orbit, tokens })
          .onConflictDoUpdate({ target: tokenUsage.orbit, set: { tokens: sql`${tokenUsage.tokens} + ${tokens}` } })
          .run(),
      );
    },
    upsertFixtures(rows) {
      db.transaction(() => {
        for (const row of rows) orm.insert(evalFixtures).values(row).onConflictDoUpdate({ target: evalFixtures.name, set: row }).run();
      });
    },
    fixtures: () => orm.select().from(evalFixtures).orderBy(evalFixtures.fixtureSet, evalFixtures.name).all(),
  };
}
