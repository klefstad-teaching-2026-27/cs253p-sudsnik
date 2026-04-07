import { afterEach, describe, expect, it } from "vitest";
import { createApp, variant } from "../../src/index.js";
import { boot, deliver, event, headers, orderPlaced, type Booted } from "../helpers.js";

const body = { habitatId: "hab01", orderId: "o1", channel: "habitat-console", template: "order.placed", params: { orderId: "o1", podId: "hab01-p001" } };

/** What every variant of notify does at its routes; what only the golden one does is in `test/hidden/`. */
describe("routes", () => {
  let b: Booted;
  afterEach(() => b?.app.sudsnik.drain());

  it("POST /notifications delivers at once inside the window and answers 201 with the notification", async () => {
    b = await boot(createApp);
    const res = await b.app.inject({ method: "POST", url: "/notifications", headers: headers(), payload: body });
    expect(res.statusCode).toBe(201);
    const n = res.json() as { notificationId: string; state: string; tenantId: string; deliveredAt?: number; params: Record<string, string> };
    expect(n.state).toBe("delivered");
    expect(n.tenantId).toBe("op1");
    expect(n.deliveredAt).toBe(0);
    expect(n.params).toEqual(body.params);
    expect(b.relayCalls).toBe(1);
  });

  it("POST /notifications replays the same response on the same idempotency key", async () => {
    b = await boot(createApp);
    const first = await b.app.inject({ method: "POST", url: "/notifications", headers: headers("same"), payload: body });
    const replay = await b.app.inject({ method: "POST", url: "/notifications", headers: headers("same"), payload: body });
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json()).toEqual(first.json());
  });

  it("POST /notifications rejects an unknown habitat with 400", async () => {
    b = await boot(createApp);
    const res = await b.app.inject({ method: "POST", url: "/notifications", headers: headers(), payload: { ...body, habitatId: "moonbase" } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe("INVALID");
  });

  it("delivers a triage.completed notification to the order's habitat", async () => {
    b = await boot(createApp);
    await deliver(b, orderPlaced("o1"));
    await deliver(b, event("triage.completed", { reportId: "r1", orderId: "o1", podId: "hab01-p001", category: "stain", severity: "low", action: "clean", tokens: 10 }));
    expect(b.relayCalls).toBe(2);
    expect(b.deps.telemetry.counters()["notify.ingested"]).toBe(2);
    expect(b.deps.telemetry.counters()["notify.unaddressable"]).toBeUndefined();
  });

  it("reports the variant this tree selected on /version", async () => {
    b = await boot(createApp);
    expect(((await b.app.inject("/version")).json() as { variant: string }).variant).toBe(variant);
  });
});
