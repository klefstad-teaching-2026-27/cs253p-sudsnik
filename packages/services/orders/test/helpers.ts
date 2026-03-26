import { join } from "node:path";
import Database from "better-sqlite3";
import { IDEMPOTENCY_HEADER, TENANT_HEADER, makeEnvelope, parseFlags, type Envelope, type PayloadOf, type ServiceDeps, type Topic } from "@sudsnik/contracts";
import type { Order, OrderState } from "@sudsnik/contracts/services/orders";
import { fakeDeps, ok, type FakeDeps } from "@sudsnik/contracts/testing";
import type { App, SudsnikApp } from "@sudsnik/infra-http";
import { handlersDir } from "../src/core/paths.js";
// The selector, so this helper works in any tree: the starter ships one variant and `src/index.ts` names it (§8).
import { createApp as createSelected } from "../src/index.js";

export const SEED = "00000000c0ffee00";
export type TestApp = App & { sudsnik: SudsnikApp };
export type Create = (deps: ServiceDeps) => Promise<TestApp>;

export interface Stack {
  app: TestApp;
  deps: FakeDeps;
}

/** A fresh app on fresh fakes. `billing` false turns the flag off; the default fake billing client fails UNAVAILABLE. */
export async function boot(opts: { create?: Create; billing?: boolean } = {}): Promise<Stack> {
  const deps = fakeDeps(SEED, "orders", { handlersDir });
  if (opts.billing === false) deps.flags = parseFlags("orders.enabled");
  const app = await (opts.create ?? createSelected)(deps);
  return { app, deps };
}

let keyCounter = 0;
export function headers(tenant = "op1", key?: string): Record<string, string> {
  return { [TENANT_HEADER]: tenant, [IDEMPOTENCY_HEADER]: key ?? `k-${++keyCounter}` };
}

export async function place(app: TestApp, body: { habitatId?: string; podId?: string; notes?: string } = {}, tenant = "op1"): Promise<Order> {
  const res = await app.inject({ method: "POST", url: "/orders", headers: headers(tenant), payload: { habitatId: "hab01", podId: `hab01-p${String(++keyCounter).padStart(3, "0")}`, ...body } });
  if (res.statusCode !== 201) throw new Error(`place -> ${res.statusCode} ${res.body}`);
  return res.json() as Order;
}

export async function getOrder(app: TestApp, orderId: string, tenant = "op1"): Promise<Order> {
  const res = await app.inject({ method: "GET", url: `/orders/${orderId}`, headers: headers(tenant) });
  if (res.statusCode !== 200) throw new Error(`get -> ${res.statusCode} ${res.body}`);
  return res.json() as Order;
}

export async function cancel(app: TestApp, orderId: string, reason = "changed my mind", tenant = "op1") {
  return app.inject({ method: "POST", url: `/orders/${orderId}/cancel`, headers: headers(tenant), payload: { reason } });
}

export async function deliver<T extends Topic>(deps: FakeDeps, topic: T, payload: PayloadOf<T>, tenantId = "op1"): Promise<Envelope<PayloadOf<T>>> {
  const envelope = makeEnvelope({ topic, tenantId, occurredAt: deps.clock.now(), payload });
  const results = await deps.bus.deliver(envelope);
  for (const r of results) if (!r.ok) throw new Error(`${topic} handler failed: ${r.error.message}`);
  return envelope;
}

/** The event that moves an order from its state to the next along the happy path. */
export function stepPayload(order: Order, topic: Topic): unknown {
  const base = { orderId: order.orderId, podId: order.podId, shuttleId: "sh1" };
  switch (topic) {
    case "pickup.scheduled":
      return { orderId: order.orderId, podId: order.podId, habitatId: order.habitatId, nodeId: "B", shuttleId: "sh1", windowStart: 0, windowEnd: 600_000 };
    case "return.scheduled":
      return { orderId: order.orderId, podId: order.podId, habitatId: order.habitatId, nodeId: "B", shuttleId: "sh1", windowStart: 0, windowEnd: 600_000 };
    case "pod.collected":
      return { ...base, collectedAt: 1 };
    case "pod.delivered":
      return { orderId: order.orderId, podId: order.podId, nodeId: "B", holdId: "hold-1", deliveredAt: 2 };
    case "wash.started":
      return { orderId: order.orderId, washerId: "B1", startedAt: 3 };
    case "wash.completed":
      return { orderId: order.orderId, washerId: "B1", completedAt: 4, cycleUnits: 7 };
    case "pod.returned":
      return { ...base, returnedAt: 5 };
    default:
      throw new Error(`no happy-path payload for ${topic}`);
  }
}

const HAPPY_PATH: Array<[OrderState, Topic]> = [
  ["scheduled", "pickup.scheduled"],
  ["collected", "pod.collected"],
  ["delivered", "pod.delivered"],
  ["washing", "wash.started"],
  ["washed", "wash.completed"],
  ["returning", "return.scheduled"],
  ["returned", "pod.returned"],
];

/** Delivers every happy-path event for `order` and reads nothing: the only path a scenario run drives. */
export async function driveByEvents(stack: Stack, order: Order): Promise<void> {
  for (const [, topic] of HAPPY_PATH) await deliver(stack.deps, topic, stepPayload(order, topic) as never, order.tenantId);
}

/** Drives a freshly placed order along the happy path until it is in `state`. */
export async function driveTo(stack: Stack, order: Order, state: OrderState): Promise<Order> {
  for (const [reached, topic] of HAPPY_PATH) {
    if (order.state === state) break;
    await deliver(stack.deps, topic, stepPayload(order, topic) as never, order.tenantId);
    order = await getOrder(stack.app, order.orderId, order.tenantId);
    if (order.state !== reached) throw new Error(`expected ${reached} after ${topic}, got ${order.state}`);
  }
  if (order.state !== state) throw new Error(`could not reach ${state}`);
  return order;
}

export interface StepRow {
  order_id: string;
  step: string;
  at: number;
  detail: string | null;
}

/** Reads orders.sqlite the way the release train does: a separate read-only connection. */
export function readDb<T>(deps: FakeDeps, fn: (db: Database.Database) => T): T {
  const db = new Database(join(deps.dataDir, "orders.sqlite"), { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function steps(deps: FakeDeps, orderId: string): StepRow[] {
  return readDb(deps, (db) => db.prepare("select order_id, step, at, detail from saga_steps where order_id = ? order by seq").all(orderId) as StepRow[]);
}

/** Billing fakes that authorize and refund every order for `amount`. Returns the call counts. */
export function fakeBilling(deps: FakeDeps, amount = 4_900): { quotes: number; authorizes: number; refunds: number } {
  const calls = { quotes: 0, authorizes: 0, refunds: 0 };
  // The real client charges INTERNAL_CALL per request; a cost comparison over these fakes is only honest if they do too.
  const billed = <T>(value: T) => {
    deps.meter.charge("INTERNAL_CALL", 1, { service: deps.service });
    return ok(value);
  };
  const charge = (orderId: string, state: "authorized" | "refunded") => ({ chargeId: `ch-${orderId}`, tenantId: "op1", orderId, amount, currency: "USD", state, updatedAt: deps.clock.now() });
  deps.clients.billing.quote = async (orderId) => {
    calls.quotes++;
    return billed({ orderId, amount, currency: "USD", breakdown: { base: amount, cycleUnits: 0, tier: "standard" } });
  };
  deps.clients.billing.authorize = async (orderId) => {
    calls.authorizes++;
    return billed(charge(orderId, "authorized"));
  };
  deps.clients.billing.refund = async (orderId) => {
    calls.refunds++;
    return billed(charge(orderId, "refunded"));
  };
  return calls;
}
