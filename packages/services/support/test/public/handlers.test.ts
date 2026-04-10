import { afterEach, describe, expect, it } from "vitest";
import { makeEnvelope, type Envelope } from "@sudsnik/contracts";
import type { AnomalyReported } from "@sudsnik/contracts/events";
import { boot, type Booted } from "../helpers.js";

describe("handlers", () => {
  let b: Booted;
  afterEach(() => b.close());

  it("records order.returned once per envelope", async () => {
    b = await boot();
    const e = makeEnvelope({ topic: "order.returned", tenantId: "op1", occurredAt: 5, payload: { orderId: "ord9", podId: "hab02-p007", habitatId: "hab02", returnedAt: 5, orbitsElapsed: 2.5 } });
    for (const r of [...(await b.deps.bus.deliver(e)), ...(await b.deps.bus.deliver(e))]) expect(r.ok).toBe(true);
    expect(b.internals.store.orderReturned("ord9")).toEqual({ orderId: "ord9", tenantId: "op1", podId: "hab02-p007", habitatId: "hab02", returnedAt: 5, orbitsElapsed: 2.5 });
    expect(b.internals.db.readOne<{ n: number }>("select count(*) as n from handled_events")?.n).toBe(1);
  });

  it("opens and triages one report per wash.faulted envelope, even when redelivered", async () => {
    b = await boot();
    const e = makeEnvelope({ topic: "wash.faulted", tenantId: "op2", occurredAt: 7, payload: { orderId: "ord3", podId: "hab01-p003", washerId: "B3", faultCode: "E12", attempt: 1, final: false } });
    await b.deps.bus.deliver(e);
    await b.deps.bus.deliver(e);
    const reported = b.deps.bus.ofTopic<AnomalyReported>("anomaly.reported");
    expect(reported).toHaveLength(1);
    expect(reported[0]!.payload).toMatchObject({ orderId: "ord3", podId: "hab01-p003", note: "washer B3 fault E12" });
    expect(reported[0]!.tenantId).toBe("op2");
    expect(reported[0]!.correlationId).toBe(e.correlationId);
    expect(b.deps.bus.ofTopic("triage.completed")).toHaveLength(1);
    const report = b.internals.store.report("op2", reported[0]!.payload.reportId);
    expect(report?.state).toBe("triaged");
    expect(report?.triage?.action).not.toBe("clean");
  });

  it("records notification.failed and rejects a malformed payload without touching state", async () => {
    b = await boot();
    const good = makeEnvelope({ topic: "notification.failed", tenantId: "op1", occurredAt: 1, payload: { notificationId: "n1", channel: "relay", reason: "dark" } });
    expect((await b.deps.bus.deliver(good))[0]?.ok).toBe(true);
    expect(b.internals.store.notificationFailure("n1")).toMatchObject({ notificationId: "n1", tenantId: "op1", orderId: null, channel: "relay", reason: "dark" });
    const bad: Envelope = { ...makeEnvelope({ topic: "notification.failed", tenantId: "op1", occurredAt: 1, payload: {} }), payload: { nope: true } };
    const r = (await b.deps.bus.deliver(bad))[0];
    expect(r?.ok).toBe(false);
    expect(b.internals.db.readOne<{ n: number }>("select count(*) as n from handled_events")?.n).toBe(1);
  });
});
