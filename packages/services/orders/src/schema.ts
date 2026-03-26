import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Mirrors migrations/; the SQL files are what createApp applies. */
export const orders = sqliteTable("orders", {
  orderId: text("order_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  habitatId: text("habitat_id").notNull(),
  podId: text("pod_id").notNull(),
  state: text("state").notNull(),
  payment: text("payment").notNull(),
  placedAt: integer("placed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  shuttleId: text("shuttle_id"),
  nodeId: text("node_id"),
  holdId: text("hold_id"),
  returnedAt: integer("returned_at"),
  orbitsElapsed: real("orbits_elapsed"),
  cancelReason: text("cancel_reason"),
  notes: text("notes"),
});
export type OrderRow = typeof orders.$inferSelect;

export const sagaSteps = sqliteTable("saga_steps", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull(),
  step: text("step").notNull(),
  at: integer("at").notNull(),
  detail: text("detail"),
  envelopeId: text("envelope_id"),
});
export type SagaStepRow = typeof sagaSteps.$inferSelect;

export const consumed = sqliteTable("consumed", {
  envelopeId: text("envelope_id").primaryKey(),
  topic: text("topic").notNull(),
  at: integer("at").notNull(),
});
