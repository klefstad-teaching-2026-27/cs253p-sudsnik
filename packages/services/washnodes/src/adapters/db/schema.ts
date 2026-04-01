import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const washers = sqliteTable("washers", {
  washerId: text("washer_id").primaryKey(),
  nodeId: text("node_id").notNull(),
  /** The washer's index within its node, from canon; listings and picks run in this order. */
  idx: integer("idx").notNull(),
  firmware: text("firmware", { enum: ["v1", "v2"] }).notNull(),
  state: text("state", { enum: ["idle", "held", "washing", "faulted"] }).notNull(),
  maintenance: integer("maintenance", { mode: "boolean" }).notNull(),
  holdId: text("hold_id"),
  faultedAt: integer("faulted_at"),
});

export const nodes = sqliteTable("nodes", {
  nodeId: text("node_id").primaryKey(),
  inContact: integer("in_contact", { mode: "boolean" }).notNull(),
  lastContactAt: integer("last_contact_at"),
});

export const holds = sqliteTable("holds", {
  holdId: text("hold_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  nodeId: text("node_id").notNull(),
  washerId: text("washer_id").notNull(),
  orderId: text("order_id").notNull(),
  state: text("state", { enum: ["held", "consumed", "released", "expired"] }).notNull(),
  acquiredAt: integer("acquired_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  version: integer("version").notNull(),
  firmwareRef: text("firmware_ref").notNull(),
  endedAt: integer("ended_at"),
  reason: text("reason"),
});

export const cycles = sqliteTable("cycles", {
  cycleId: text("cycle_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  holdId: text("hold_id").notNull(),
  orderId: text("order_id").notNull(),
  podId: text("pod_id"),
  nodeId: text("node_id").notNull(),
  washerId: text("washer_id").notNull(),
  firmware: text("firmware", { enum: ["v1", "v2"] }).notNull(),
  attempt: integer("attempt").notNull(),
  state: text("state", { enum: ["running", "completed", "faulted"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  cycleUnits: integer("cycle_units"),
  faultCode: text("fault_code"),
  retryPending: integer("retry_pending", { mode: "boolean" }).notNull(),
});

export const washerReports = sqliteTable("washer_reports", {
  reportId: text("report_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  orderId: text("order_id"),
  podId: text("pod_id"),
  washerId: text("washer_id"),
  action: text("action"),
});

export const handledEvents = sqliteTable("handled_events", {
  eventId: text("event_id").primaryKey(),
  handledAt: integer("handled_at").notNull(),
});

export const washerCallbacks = sqliteTable("washer_callbacks", {
  callbackId: text("callback_id").primaryKey(),
  receivedAt: integer("received_at").notNull(),
});
