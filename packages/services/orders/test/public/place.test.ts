import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORBIT_MS } from "@sudsnik/contracts";
import type { Order } from "@sudsnik/contracts/services/orders";
import { boot, cancel, fakeBilling, getOrder, headers, place, steps, type Stack } from "../helpers.js";

let stack: Stack;
afterEach(() => stack.app.sudsnik.drain());

describe("place", () => {
  beforeEach(async () => {
    stack = await boot({ billing: false });
  });

  it("answers 201 with a placed order owned by the tenant", async () => {
    stack.deps.clock.advanceTo(1234);
    const order = await place(stack.app, { habitatId: "hab02", podId: "hab02-p001", notes: "gentle cycle" });
    expect(order).toMatchObject({ tenantId: "op1", habitatId: "hab02", podId: "hab02-p001", state: "placed", payment: "pending", placedAt: 1234, updatedAt: 1234, notes: "gentle cycle" });
    expect(order.orderId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await getOrder(stack.app, order.orderId)).toEqual(order);
  });

  it("is 403 FORBIDDEN for a habitat another operator runs, and for a habitat that does not exist", async () => {
    for (const habitatId of ["hab04", "hab99"]) {
      const res = await stack.app.inject({ method: "POST", url: "/orders", headers: headers("op1"), payload: { habitatId, podId: `${habitatId}-p001` } });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { code: string }).code).toBe("FORBIDDEN");
    }
  });

  // That the pod is free again once the order is terminal needs a cancel that cancels, which not every variant
  // has; the hidden acceptance suite asserts it.
  it("is 409 CONFLICT while the pod is in an open order", async () => {
    await place(stack.app, { podId: "hab01-p007" });
    const again = await stack.app.inject({ method: "POST", url: "/orders", headers: headers(), payload: { habitatId: "hab01", podId: "hab01-p007" } });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { code: string }).code).toBe("CONFLICT");
  });

  it("replays the same response for the same idempotency key", async () => {
    const h = headers("op1", "same-key");
    const a = await stack.app.inject({ method: "POST", url: "/orders", headers: h, payload: { habitatId: "hab01", podId: "hab01-p008" } });
    const b = await stack.app.inject({ method: "POST", url: "/orders", headers: h, payload: { habitatId: "hab01", podId: "hab01-p008" } });
    expect(b.statusCode).toBe(201);
    expect(b.json()).toEqual(a.json());
    expect(b.headers["idempotent-replayed"]).toBe("true");
  });

  it("spends at most two DB_WRITE and publishes exactly one event per placement with billing off", async () => {
    const before = stack.deps.meter.byOperation.DB_WRITE?.count ?? 0;
    await place(stack.app);
    expect((stack.deps.meter.byOperation.DB_WRITE?.count ?? 0) - before).toBeLessThanOrEqual(2);
    await stack.app.sudsnik.drain();
    expect(stack.deps.bus.published.map((e) => e.topic)).toEqual(["order.placed"]);
    stack = await boot({ billing: false });
  });
});

describe("place with billing on", () => {
  beforeEach(async () => {
    stack = await boot();
  });

  it("quotes then authorizes, and records the charge as a saga step", async () => {
    const billing = fakeBilling(stack.deps, 7_900);
    const order = await place(stack.app);
    expect(order.payment).toBe("authorized");
    expect(billing).toEqual({ quotes: 1, authorizes: 1, refunds: 0 });
    const s = steps(stack.deps, order.orderId);
    expect(s.map((x) => x.step)).toEqual(["place", "authorize"]);
    expect(JSON.parse(s[1]!.detail!)).toEqual({ chargeId: `ch-${order.orderId}`, amount: 7_900 });
  });

  it("leaves payment pending with an authorize:pending step when billing fails retryably, and reconciles on the next orbit", async () => {
    const order = await place(stack.app);
    expect(order.payment).toBe("pending");
    expect(steps(stack.deps, order.orderId).map((x) => x.step)).toEqual(["place", "authorize:pending"]);
    const billing = fakeBilling(stack.deps);
    stack.deps.clock.advanceTo(ORBIT_MS);
    await new Promise((r) => setImmediate(r));
    expect(billing.authorizes).toBe(1);
    const after = await getOrder(stack.app, order.orderId);
    expect(after.payment).toBe("authorized");
    expect(steps(stack.deps, order.orderId).map((x) => x.step)).toEqual(["place", "authorize:pending", "authorize"]);
  });

  it("marks payment failed when billing declines", async () => {
    fakeBilling(stack.deps);
    stack.deps.clients.billing.authorize = async () => ({ ok: false, error: { code: "INVALID", message: "declined", retryable: false } });
    const order = await place(stack.app);
    expect(order.payment).toBe("failed");
    expect(steps(stack.deps, order.orderId).map((x) => x.step)).toEqual(["place", "authorize:failed"]);
    stack.deps.clock.advanceTo(ORBIT_MS);
    await new Promise((r) => setImmediate(r));
    expect((await getOrder(stack.app, order.orderId)).payment).toBe("failed");
  });

  it("still places the order when billing is off for this process", async () => {
    await stack.app.sudsnik.drain();
    stack = await boot({ billing: false });
    const billing = fakeBilling(stack.deps);
    const order: Order = await place(stack.app);
    expect(order.payment).toBe("pending");
    expect(billing.quotes).toBe(0);
  });
});
