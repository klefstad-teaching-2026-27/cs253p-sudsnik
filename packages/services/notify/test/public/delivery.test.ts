import { afterEach, describe, expect, it } from "vitest";
import { MINUTE_MS } from "@sudsnik/contracts";
import type { DeliverRequest } from "@sudsnik/contracts/mocks/relay";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { deliverRequest, markDelivered, send, settle, stillPending, type DeliveryState } from "../../src/delivery/relay.js";
import { retryAfterMs } from "../../src/delivery/window.js";
import { pipeline } from "../../src/pipeline.js";
import type { NotificationRow } from "../../src/queue/store.js";
import { relayDark, wiring, HABITAT, TENANT } from "../helpers.js";

function queued(w: ReturnType<typeof wiring>, id = "n1"): NotificationRow {
  w.store.insertNotification({ notificationId: id, tenantId: TENANT, habitatId: HABITAT, orderId: "o1", channel: "habitat-console", template: "order.placed", params: { orderId: "o1" }, title: "t", body: "b", correlationId: "c1", createdAt: 0, state: "queued" });
  return w.store.notification(id)!;
}

describe("delivery stages", () => {
  let w: ReturnType<typeof wiring>;
  afterEach(() => w?.db.close());

  it("builds the relay request the brief describes", () => {
    w = wiring();
    const req = deliverRequest(queued(w), 42);
    expect(req.origin).toEqual({ kind: "ground", id: "notify" });
    expect(req.destination).toEqual({ kind: "habitat", id: HABITAT });
    expect(req.to).toBe(`habitat:${HABITAT}`);
    expect(req.path).toBe("/notifications");
    expect(req.deliverAtMs).toBe(42);
    expect(req.body.notificationId).toBe("n1");
    expect(req.body.title).toBe("t");
  });

  it("send calls relay with the tenant and a per-attempt idempotency key", async () => {
    w = wiring();
    const seen: Array<{ req: DeliverRequest; key?: string; tenant: string }> = [];
    w.deps.clients.relay.deliver = async (req, ctx) => {
      seen.push({ req, key: ctx.idempotencyKey, tenant: ctx.tenantId });
      return ok({ deliveryId: "d1" });
    };
    const out = await send(w).run({ notification: queued(w), now: 0, attempt: 0 });
    expect(out.kind).toBe("next");
    if (out.kind === "next") expect(out.state.attempt).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.tenant).toBe(TENANT);
    expect(seen[0]!.key).toBe("n1:1");
  });

  it("settle marks a success delivered and records the relay delivery id", async () => {
    w = wiring();
    const n = queued(w);
    const out = await settle(w, { maxAttempts: 5, honorRetryAfter: true }).run({ notification: n, now: 7, attempt: 1, result: ok({ deliveryId: "d1" }) });
    expect(stillPending(out)).toBe(false);
    const row = w.store.notification("n1")!;
    expect(row.state).toBe("delivered");
    expect(row.delivered_at).toBe(7);
    expect(row.attempts).toBe(1);
    expect(w.store.attempts("n1")).toMatchObject([{ attempt: 1, outcome: "delivered", relayDeliveryId: "d1" }]);
    expect(w.deps.telemetry.counters()["notify.delivered"]).toBe(1);
  });

  it("settle holds a retry for Retry-After when honoring it, and not otherwise", async () => {
    w = wiring();
    queued(w, "a");
    queued(w, "b");
    const dark = relayDark(300);
    const a = await settle(w, { maxAttempts: 5, honorRetryAfter: true }).run({ notification: w.store.notification("a")!, now: 1000, attempt: 1, result: dark });
    expect(stillPending(a)).toBe(true);
    expect(w.store.notification("a")).toMatchObject({ state: "queued", attempts: 1, not_before: 1000 + 300_000 });
    await settle(w, { maxAttempts: 5, honorRetryAfter: false }).run({ notification: w.store.notification("b")!, now: 1000, attempt: 1, result: dark });
    expect(w.store.notification("b")).toMatchObject({ state: "queued", attempts: 1, not_before: 0 });
  });

  it("settle dead-letters at the attempt budget and enqueues notification.failed once", async () => {
    w = wiring();
    const n = queued(w);
    const out = await settle(w, { maxAttempts: 5, honorRetryAfter: true }).run({ notification: { ...n, attempts: 4 }, now: 9, attempt: 5, result: relayDark(60) });
    expect(stillPending(out)).toBe(false);
    expect(w.store.notification("n1")).toMatchObject({ state: "failed", attempts: 5 });
    expect(w.store.deadLetters()).toMatchObject([{ notification_id: "n1", tenant_id: TENANT, attempts: 5, dead_at: 9 }]);
    expect(w.outbox.pending()).toBe(1);
    await w.outbox.pump();
    const failed = w.deps.bus.ofTopic<{ notificationId: string; orderId?: string; channel: string; reason: string }>("notification.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.tenantId).toBe(TENANT);
    expect(failed[0]!.correlationId).toBe("c1");
    expect(failed[0]!.payload).toMatchObject({ notificationId: "n1", orderId: "o1", channel: "habitat-console" });
    expect(w.deps.telemetry.counters()["notify.dead_letters"]).toBe(1);
  });

  it("settle dead-letters a non-retryable refusal on the first attempt", async () => {
    w = wiring();
    const n = queued(w);
    await settle(w, { maxAttempts: 5, honorRetryAfter: true }).run({ notification: n, now: 0, attempt: 1, result: err(sudsnikError("INVALID", "bad body")) });
    expect(w.store.notification("n1")?.state).toBe("failed");
    expect(w.store.deadLetters()).toHaveLength(1);
  });

  it("settle with an unbounded budget keeps retrying a retryable failure", async () => {
    w = wiring();
    const n = queued(w);
    await settle(w, { maxAttempts: Number.POSITIVE_INFINITY, honorRetryAfter: false }).run({ notification: { ...n, attempts: 99 }, now: 0, attempt: 100, result: relayDark(60) });
    expect(w.store.notification("n1")).toMatchObject({ state: "queued", attempts: 100 });
    expect(w.store.deadLetters()).toHaveLength(0);
  });

  it("markDelivered counts an error as delivered", async () => {
    w = wiring();
    const run = pipeline<DeliveryState>("d", [markDelivered(w)]);
    await run({ notification: queued(w), now: 3, attempt: 1, result: relayDark(60) });
    expect(w.store.notification("n1")).toMatchObject({ state: "delivered", delivered_at: 3 });
  });

  it("reads Retry-After seconds from the error cause", () => {
    const dark = relayDark(90);
    expect(dark.ok).toBe(false);
    if (!dark.ok) expect(retryAfterMs(dark.error)).toBe(90_000);
    expect(retryAfterMs(sudsnikError("UNAVAILABLE", "down"))).toBeUndefined();
    expect(retryAfterMs({ ...sudsnikError("UNAVAILABLE", "down"), cause: { headers: { "retry-after": "soon" } } })).toBeUndefined();
  });
});
