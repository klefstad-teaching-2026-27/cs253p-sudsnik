import { and, eq, gt, notInArray } from "drizzle-orm";
import { TERMINAL_STATES, type Order, type OrderFilter, type OrderState, type PaymentState } from "@sudsnik/contracts/services/orders";
import type { Db } from "@sudsnik/infra-db";
import { consumed, orders, sagaSteps, type OrderRow } from "../schema.js";

export interface SagaStep {
  orderId: string;
  step: string;
  at: number;
  detail?: unknown;
  /** The envelope that caused the step, when an event did; the causation trace a variant can dedupe on. */
  envelopeId?: string;
}

/** Drizzle over orders.sqlite. Every method is one statement unless it says otherwise; callers group them with `transaction`. */
export class OrderRepository {
  constructor(protected readonly db: Db) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  insert(order: Order): void {
    this.db.orm.insert(orders).values(toRow(order)).run();
  }

  update(order: Order): void {
    const { orderId, ...rest } = toRow(order);
    this.db.orm.update(orders).set(rest).where(eq(orders.orderId, orderId)).run();
  }

  findById(tenantId: string, orderId: string): Order | undefined {
    const row = this.db.orm
      .select()
      .from(orders)
      .where(and(eq(orders.orderId, orderId), eq(orders.tenantId, tenantId)))
      .get();
    return row ? toOrder(row) : undefined;
  }

  /** The order an event names, whatever its tenant; the envelope's tenantId is checked by the caller. */
  findAnyById(orderId: string): Order | undefined {
    const row = this.db.orm.select().from(orders).where(eq(orders.orderId, orderId)).get();
    return row ? toOrder(row) : undefined;
  }

  hasOpenOrderForPod(tenantId: string, podId: string): boolean {
    const row = this.db.orm
      .select({ orderId: orders.orderId })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.podId, podId), notInArray(orders.state, [...TERMINAL_STATES])))
      .limit(1)
      .get();
    return row !== undefined;
  }

  list(tenantId: string, filter: OrderFilter): Order[] {
    const where = [eq(orders.tenantId, tenantId)];
    if (filter.state) where.push(eq(orders.state, filter.state));
    if (filter.habitatId) where.push(eq(orders.habitatId, filter.habitatId));
    if (filter.cursor) where.push(gt(orders.orderId, filter.cursor));
    return this.db.orm
      .select()
      .from(orders)
      .where(and(...where))
      .orderBy(orders.orderId)
      .limit(filter.limit)
      .all()
      .map(toOrder);
  }

  addStep(step: SagaStep): void {
    this.db.orm
      .insert(sagaSteps)
      .values({ orderId: step.orderId, step: step.step, at: step.at, detail: step.detail === undefined ? null : JSON.stringify(step.detail), envelopeId: step.envelopeId ?? null })
      .run();
  }

  steps(orderId: string): SagaStep[] {
    return this.db.orm
      .select()
      .from(sagaSteps)
      .where(eq(sagaSteps.orderId, orderId))
      .orderBy(sagaSteps.seq)
      .all()
      .map((r) => ({ orderId: r.orderId, step: r.step, at: r.at, ...(r.detail === null ? {} : { detail: JSON.parse(r.detail) as unknown }), ...(r.envelopeId === null ? {} : { envelopeId: r.envelopeId }) }));
  }

  /** Non-terminal orders with this payment state; the reconciliation job's authorization candidates. */
  openWithPayment(payment: PaymentState): Order[] {
    return this.db.orm
      .select()
      .from(orders)
      .where(and(eq(orders.payment, payment), notInArray(orders.state, [...TERMINAL_STATES])))
      .all()
      .map(toOrder);
  }

  cancelledWithPayment(payment: PaymentState): Order[] {
    return this.db.orm
      .select()
      .from(orders)
      .where(and(eq(orders.payment, payment), eq(orders.state, "cancelled")))
      .all()
      .map(toOrder);
  }

  /** The most recent saga step named `kind` or `kind:<outcome>`. */
  latestStep(orderId: string, kind: string): string | undefined {
    return this.steps(orderId)
      .map((s) => s.step)
      .filter((s) => s === kind || s.startsWith(`${kind}:`))
      .pop();
  }

  /** Records the envelope; false when it was recorded before. */
  claim(envelopeId: string, topic: string, at: number): boolean {
    return this.db.orm.insert(consumed).values({ envelopeId, topic, at }).onConflictDoNothing().run().changes === 1;
  }
}

export function toRow(o: Order): OrderRow {
  return {
    orderId: o.orderId,
    tenantId: o.tenantId,
    habitatId: o.habitatId,
    podId: o.podId,
    state: o.state,
    payment: o.payment,
    placedAt: o.placedAt,
    updatedAt: o.updatedAt,
    shuttleId: o.shuttleId ?? null,
    nodeId: o.nodeId ?? null,
    holdId: o.holdId ?? null,
    returnedAt: o.returnedAt ?? null,
    orbitsElapsed: o.orbitsElapsed ?? null,
    cancelReason: o.cancelReason ?? null,
    notes: o.notes ?? null,
  };
}

function toOrder(r: OrderRow): Order {
  const o: Order = {
    orderId: r.orderId,
    tenantId: r.tenantId,
    habitatId: r.habitatId,
    podId: r.podId,
    state: r.state as OrderState,
    payment: r.payment as PaymentState,
    placedAt: r.placedAt,
    updatedAt: r.updatedAt,
  };
  if (r.shuttleId !== null) o.shuttleId = r.shuttleId;
  if (r.nodeId !== null) o.nodeId = r.nodeId;
  if (r.holdId !== null) o.holdId = r.holdId;
  if (r.returnedAt !== null) o.returnedAt = r.returnedAt;
  if (r.orbitsElapsed !== null) o.orbitsElapsed = r.orbitsElapsed;
  if (r.cancelReason !== null) o.cancelReason = r.cancelReason;
  if (r.notes !== null) o.notes = r.notes;
  return o;
}
