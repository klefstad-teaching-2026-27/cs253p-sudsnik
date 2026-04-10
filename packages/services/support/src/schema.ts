import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const REPORT_STATES = ["received", "triaged", "escalated"] as const;

export const reports = sqliteTable(
  "reports",
  {
    reportId: text("report_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    orderId: text("order_id").notNull(),
    podId: text("pod_id").notNull(),
    note: text("note").notNull(),
    receivedAt: integer("received_at").notNull(),
    state: text("state", { enum: REPORT_STATES }).notNull(),
    /** The latest triage result; earlier ones stay in triage_results for the per-orbit token sum. */
    triageId: text("triage_id"),
  },
  (t) => [index("reports_tenant").on(t.tenantId, t.receivedAt)],
);

export const triageResults = sqliteTable(
  "triage_results",
  {
    triageId: text("triage_id").primaryKey(),
    reportId: text("report_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    action: text("action").notNull(),
    tokens: integer("tokens").notNull(),
    guarded: integer("guarded", { mode: "boolean" }).notNull(),
    triagedAt: integer("triaged_at").notNull(),
  },
  (t) => [index("triage_results_report").on(t.reportId, t.triagedAt)],
);

export const ordersSeen = sqliteTable("orders_seen", {
  orderId: text("order_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  podId: text("pod_id").notNull(),
  habitatId: text("habitat_id").notNull(),
  returnedAt: integer("returned_at").notNull(),
  orbitsElapsed: real("orbits_elapsed").notNull(),
});

export const notificationFailures = sqliteTable("notification_failures", {
  notificationId: text("notification_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  orderId: text("order_id"),
  channel: text("channel").notNull(),
  reason: text("reason").notNull(),
  recordedAt: integer("recorded_at").notNull(),
});

export const evalFixtures = sqliteTable("eval_fixtures", {
  name: text("name").primaryKey(),
  fixtureSet: text("fixture_set").notNull(),
  note: text("note").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  action: text("action").notNull(),
  injected: integer("injected", { mode: "boolean" }).notNull(),
});

export const handledEvents = sqliteTable("handled_events", {
  envelopeId: text("envelope_id").primaryKey(),
  topic: text("topic").notNull(),
  handledAt: integer("handled_at").notNull(),
});

export const tokenUsage = sqliteTable("token_usage", {
  orbit: integer("orbit").primaryKey(),
  tokens: integer("tokens").notNull(),
});
