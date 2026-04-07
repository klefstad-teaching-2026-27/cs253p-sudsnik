import { afterEach, describe, expect, it } from "vitest";
import { MINUTE_MS } from "@sudsnik/contracts";
import type { Wiring } from "../../src/app.js";
import { pipeline } from "../../src/pipeline.js";
import { parse, persist, render, resolve, type IngestContext, type IngestState } from "../../src/queue/ingest.js";
import { event, orderPlaced, wiring, HABITAT, TENANT } from "../helpers.js";

const queued = () => "queued" as const;
const markSeenOnce = (ctx: IngestContext, envelopeId: string, tenantId: string, notificationId: string, now: number) => ctx.store.markSeen(tenantId, envelopeId, notificationId, now);
const always = () => true;

describe("ingest stages", () => {
  let w: Wiring;
  afterEach(() => w?.db.close());

  const ingest = (dedupe = true) => pipeline<IngestState>("ingest", [parse(), resolve(w), render(), persist(w, { first: dedupe ? markSeenOnce : always, initialState: queued })]);

  it("parses, resolves, renders, and persists an order.placed, remembering the order's habitat", async () => {
    w = wiring();
    const out = await ingest()({ envelope: orderPlaced("o1"), now: 5 });
    expect(out.kind).toBe("next");
    if (out.kind !== "next") return;
    const n = out.state.notification!;
    expect(n.habitat_id).toBe(HABITAT);
    expect(n.order_id).toBe("o1");
    expect(n.template).toBe("order.placed");
    expect(n.channel).toBe("habitat-console");
    expect(n.title).toBe("Laundry order placed");
    expect(n.state).toBe("queued");
    expect(n.created_at).toBe(5);
    expect(w.store.habitatOfOrder(TENANT, "o1")).toBe(HABITAT);
  });

  it("resolves a later order event through the orders table", async () => {
    w = wiring();
    await ingest()({ envelope: orderPlaced("o1"), now: 0 });
    const out = await ingest()({ envelope: event("charge.captured", { orderId: "o1", chargeId: "c1", amount: 4900, currency: "USD" }), now: MINUTE_MS });
    expect(out.kind).toBe("next");
    if (out.kind === "next") expect(out.state.notification?.habitat_id).toBe(HABITAT);
  });

  it("takes the habitat from pickup.scheduled and return.scheduled without a lookup", async () => {
    w = wiring();
    const scheduled = { orderId: "o9", podId: "hab03-p001", habitatId: "hab03", nodeId: "B", shuttleId: "sh1", windowStart: 0, windowEnd: MINUTE_MS };
    const envelopes = [event("pickup.scheduled", scheduled), event("return.scheduled", scheduled)];
    for (const envelope of envelopes) {
      const topic = envelope.topic;
      const out = await ingest()({ envelope, now: 0 });
      expect(out.kind, topic).toBe("next");
      if (out.kind === "next") expect(out.state.notification?.habitat_id).toBe("hab03");
    }
    expect(w.store.habitatOfOrder(TENANT, "o9")).toBe("hab03");
  });

  it("fails retryably when the order is not yet known, so the bus redelivers", async () => {
    w = wiring();
    const out = await ingest()({ envelope: event("charge.failed", { orderId: "o-unknown", reason: "declined" }), now: 0 });
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.error.retryable).toBe(true);
    expect(w.store.pendingCount()).toBe(0);
  });

  it("resolves triage.completed through the orders table, or from its pod id when the order is unknown", async () => {
    w = wiring();
    await ingest()({ envelope: orderPlaced("o1", "hab02"), now: 0 });
    const triage = (reportId: string, orderId: string, podId: string) => event("triage.completed", { reportId, orderId, podId, category: "stain", severity: "low", action: "clean", tokens: 10 });
    const known = await ingest()({ envelope: triage("r1", "o1", "hab07-p001"), now: 0 });
    expect(known.kind).toBe("next");
    if (known.kind === "next") expect(known.state.notification).toMatchObject({ habitat_id: "hab02", template: "triage.completed", title: "Anomaly report triaged" });
    const byPod = await ingest()({ envelope: triage("r2", "o-unknown", "hab07-p001"), now: 0 });
    expect(byPod.kind).toBe("next");
    if (byPod.kind === "next") expect(byPod.state.notification?.habitat_id).toBe("hab07");
    expect((await ingest()({ envelope: triage("r3", "o-unknown", "moon-p001"), now: 0 })).kind).toBe("fail");
  });

  it("acknowledges an event naming an unknown habitat without writing", async () => {
    w = wiring();
    expect((await ingest()({ envelope: orderPlaced("o2", "moonbase"), now: 0 })).kind).toBe("halt");
    expect(w.store.pendingCount()).toBe(0);
    expect(w.deps.telemetry.counters()["notify.unaddressable"]).toBe(1);
  });

  it("fails on a payload that does not match the topic's schema", async () => {
    w = wiring();
    const out = await ingest()({ envelope: event("order.placed", { orderId: "o1" }), now: 0 });
    expect(out.kind).toBe("fail");
  });

  it("halts a repeated envelope id and keeps one notification; without dedupe it writes twice", async () => {
    w = wiring();
    const e = orderPlaced("o1");
    expect((await ingest()({ envelope: e, now: 0 })).kind).toBe("next");
    const again = await ingest()({ envelope: e, now: 1 });
    expect(again.kind).toBe("halt");
    expect(w.store.pendingCount()).toBe(1);
    expect(w.deps.telemetry.counters()["notify.duplicates"]).toBe(1);
    expect((await ingest(false)({ envelope: e, now: 2 })).kind).toBe("next");
    expect(w.store.pendingCount()).toBe(2);
  });

  it("scopes the orders lookup and dedupe by tenant", async () => {
    w = wiring();
    await ingest()({ envelope: orderPlaced("o1"), now: 0 });
    const other = event("charge.captured", { orderId: "o1", chargeId: "c1", amount: 1, currency: "USD" }, "op2");
    expect((await ingest()({ envelope: other, now: 0 })).kind).toBe("fail");
  });
});
