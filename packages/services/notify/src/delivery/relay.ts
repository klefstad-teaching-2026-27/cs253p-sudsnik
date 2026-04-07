import type { DeliverRequest } from "@sudsnik/contracts/mocks/relay";
import { makeEnvelope, type ServiceDeps } from "@sudsnik/contracts";
import type { NotificationFailed } from "@sudsnik/contracts/events";
import type { Outbox } from "@sudsnik/infra-queue";
import { newId, type Result, type SudsnikError } from "@sudsnik/kernel";
import { fail, halt, next, stage, type Outcome, type Stage } from "../pipeline.js";
import type { NotificationRow, Store } from "../queue/store.js";
import { inLinkWindow, retryAfterMs } from "./window.js";

export interface DeliveryState {
  notification: NotificationRow;
  now: number;
  attempt: number;
  result?: Result<{ deliveryId: string }>;
}

export interface DeliveryContext {
  deps: ServiceDeps;
  store: Store;
  outbox: Outbox;
}

/** Retry budget: dead-letter after this many failed attempts; `Infinity` retries until delivered. */

export function deliverRequest(n: NotificationRow, now: number): DeliverRequest {
  return {
    origin: { kind: "ground", id: "notify" },
    destination: { kind: "habitat", id: n.habitat_id },
    to: `habitat:${n.habitat_id}`,
    path: "/notifications",
    body: {
      notificationId: n.notification_id,
      ...(n.order_id === null ? {} : { orderId: n.order_id }),
      channel: n.channel,
      template: n.template,
      title: n.title,
      body: n.body,
      params: JSON.parse(n.params) as Record<string, string>,
      createdAt: n.created_at,
    },
    deliverAtMs: now,
  };
}

/** Leaves the notification queued while its habitat is outside its link window or relay's Retry-After hold has not passed. */
export function send(ctx: DeliveryContext): Stage<DeliveryState> {
  return stage("send", async (s) => {
    const n = s.notification;
    const attempt = n.attempts + 1;
    const result = await ctx.deps.clients.relay.deliver(deliverRequest(n, s.now), {
      tenantId: n.tenant_id,
      correlationId: n.correlation_id,
      idempotencyKey: `${n.notification_id}:${attempt}`,
    });
    return next({ ...s, attempt, result });
  });
}

export interface SettleOptions {
  maxAttempts: number;
  /** Hold the retry for relay's `Retry-After` when it sends one. */
  honorRetryAfter: boolean;
}

/** Records the attempt: delivered on success; on failure a retry hold, or a dead letter once the budget is spent. */
export function settle(ctx: DeliveryContext, opts: SettleOptions): Stage<DeliveryState> {
  const counter = (name: string) => ctx.deps.telemetry.counter(name).add(1);
  return stage("settle", (s) => {
    const { notification: n, result, attempt, now } = s;
    if (!result) return fail({ code: "INTERNAL", message: "settle before send", retryable: false });
    if (result.ok) {
      ctx.store.transaction(() => {
        ctx.store.recordAttempt({ deliveryId: newId(), notificationId: n.notification_id, tenantId: n.tenant_id, attempt, attemptedAt: now, outcome: "delivered", relayDeliveryId: result.value.deliveryId }, 0);
        ctx.store.setState(n.notification_id, "delivered", now);
      });
      counter("notify.delivered");
      return next({ ...s, notification: { ...n, attempts: attempt, state: "delivered", delivered_at: now } });
    }
    const error = result.error;
    counter("notify.relay_failures");
    const exhausted = attempt >= opts.maxAttempts || !error.retryable;
    const hold = opts.honorRetryAfter ? retryAfterMs(error) : undefined;
    const notBefore = hold === undefined ? 0 : now + hold;
    ctx.store.transaction(() => {
      ctx.store.recordAttempt({ deliveryId: newId(), notificationId: n.notification_id, tenantId: n.tenant_id, attempt, attemptedAt: now, outcome: "failed", error: error.message }, notBefore);
      if (exhausted) deadLetter(ctx, n, attempt, error, now);
    });
    if (exhausted) counter("notify.dead_letters");
    return next({ ...s, notification: { ...n, attempts: attempt, not_before: notBefore, state: exhausted ? "failed" : n.state } });
  });
}

function deadLetter(ctx: DeliveryContext, n: NotificationRow, attempts: number, error: SudsnikError, now: number): void {
  ctx.store.deadLetter(n.notification_id, n.tenant_id, attempts, error.message, now);
  ctx.store.setState(n.notification_id, "failed");
  const payload: NotificationFailed = { notificationId: n.notification_id, ...(n.order_id === null ? {} : { orderId: n.order_id }), channel: n.channel, reason: error.message };
  ctx.outbox.enqueue(makeEnvelope({ topic: "notification.failed", tenantId: n.tenant_id, occurredAt: now, correlationId: n.correlation_id, payload }));
}

/** The starter's settle: any answer from relay, including an error, counts as delivered. */
export function markDelivered(ctx: DeliveryContext): Stage<DeliveryState> {
  return stage("mark-delivered", (s) => {
    const { notification: n, attempt, now } = s;
    ctx.store.transaction(() => {
      ctx.store.recordAttempt({ deliveryId: newId(), notificationId: n.notification_id, tenantId: n.tenant_id, attempt, attemptedAt: now, outcome: "delivered", ...(s.result?.ok ? { relayDeliveryId: s.result.value.deliveryId } : {}) }, 0);
      ctx.store.setState(n.notification_id, "delivered", now);
    });
    return next({ ...s, notification: { ...n, attempts: attempt, state: "delivered", delivered_at: now } });
  });
}

/** True when the notification still awaits delivery after this outcome. */
export function stillPending(o: Outcome<DeliveryState>): boolean {
  if (o.kind !== "next") return true;
  const state = o.state.notification.state;
  return state === "queued" || state === "digested";
}
