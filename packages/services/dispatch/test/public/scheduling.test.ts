import { afterEach, describe, expect, it } from "vitest";
import { HABITATS, LINK_WINDOW_MINUTES, MINUTE_MS, ORBIT_MS, isHabitatVisible, type PayloadOf } from "@sudsnik/contracts";
import type { Assignment } from "@sudsnik/contracts/services/dispatch";
import { createApp } from "../../src/index.js";
import { MAX_ATTEMPTS } from "../../src/scheduler.js";
import { createApp as createNaive, handlersDir as naiveHandlers } from "../../src/variants/naive/index.js";
import { buildCallback, buildDeps, buildHoldExpired, buildOrderCancelled, buildOrderPlaced, buildWashCompleted, relayHeaders, stubClients, writeHeaders } from "../support/builders.js";

const apps: Array<{ sudsnik: { drain(): Promise<void> } }> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.sudsnik.drain();
});

async function boot(opts: { free?: Record<string, number>; env?: Record<string, string> } = {}) {
  const deps = buildDeps();
  if (opts.env) Object.assign(deps.env, opts.env);
  const calls = stubClients(deps, { free: opts.free });
  const app = await createApp(deps);
  apps.push(app);
  return { deps, calls, app };
}

describe("pickup scheduling", () => {
  it("schedules one pickup in the habitat's next link window at the freest node, holding nothing yet", async () => {
    const { deps, calls, app } = await boot({ free: { A: 2, B: 7, C: 4 } });
    deps.clock.advanceTo(12 * MINUTE_MS);
    const placed = buildOrderPlaced({ habitatId: "hab03" });
    await deps.bus.deliver(placed);

    const events = deps.bus.ofTopic<PayloadOf<"pickup.scheduled">>("pickup.scheduled");
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.tenantId).toBe("op1");
    expect(e.payload.orderId).toBe(placed.payload.orderId);
    expect(e.payload.podId).toBe(placed.payload.podId);
    expect(e.payload.habitatId).toBe("hab03");
    expect(e.payload.nodeId).toBe("B");
    expect(e.payload.windowStart).toBeGreaterThanOrEqual(12 * MINUTE_MS);
    expect(isHabitatVisible("hab03", e.payload.windowStart)).toBe(true);
    expect(e.payload.windowEnd - e.payload.windowStart).toBe(LINK_WINDOW_MINUTES * MINUTE_MS);
    expect(calls.acquireHold).toEqual([]);

    const res = await app.inject({ method: "GET", url: `/assignments/${placed.payload.orderId}`, headers: relayHeaders() });
    const rows = res.json() as Assignment[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leg: "pickup", nodeId: "B", state: "scheduled", shuttleId: e.payload.shuttleId });
    expect(rows[0]!.holdId).toBeUndefined();
  });

  it("breaks a tie on free washers by node letter", async () => {
    const { deps } = await boot({ free: { A: 4, B: 4, C: 4 } });
    await deps.bus.deliver(buildOrderPlaced());
    expect(deps.bus.ofTopic<PayloadOf<"pickup.scheduled">>("pickup.scheduled")[0]!.payload.nodeId).toBe("A");
  });

  it("delivers the same order.placed twice and schedules once", async () => {
    const { deps } = await boot();
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    await deps.bus.deliver(placed);
    expect(deps.bus.ofTopic("pickup.scheduled")).toHaveLength(1);
  });

  it("rotates shuttles across orders in the same window", async () => {
    const { deps } = await boot();
    for (let i = 0; i < 7; i++) await deps.bus.deliver(buildOrderPlaced({ habitatId: "hab01", podId: `hab01-p00${i + 1}` }));
    const shuttles = deps.bus.ofTopic<PayloadOf<"pickup.scheduled">>("pickup.scheduled").map((e) => e.payload.shuttleId);
    expect(shuttles).toEqual(["sh1", "sh2", "sh3", "sh4", "sh5", "sh6", "sh1"]);
  });

  it("answers POST /assignments/pickup with the existing assignment and 409 for an order it never saw", async () => {
    const { deps, app } = await boot();
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    const again = await app.inject({ method: "POST", url: "/assignments/pickup", headers: writeHeaders("k1"), payload: { orderId: placed.payload.orderId } });
    expect(again.statusCode).toBe(200);
    expect((again.json() as Assignment).leg).toBe("pickup");
    const unknown = await app.inject({ method: "POST", url: "/assignments/pickup", headers: writeHeaders("k2"), payload: { orderId: "nope" } });
    expect(unknown.statusCode).toBe(409);
  });
});

describe("back-pressure", () => {
  it("queues orders beyond SUDSNIK_DISPATCH_MAX_INFLIGHT and schedules them in order", async () => {
    const { deps, calls } = await boot({ env: { SUDSNIK_DISPATCH_MAX_INFLIGHT: "1" } });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const placed = buildOrderPlaced({ habitatId: HABITATS[i]!, podId: `${HABITATS[i]}-p001` });
      ids.push(placed.payload.orderId);
      await deps.bus.deliver(placed);
    }
    expect(calls.windows).toBe(4);
    expect(deps.bus.ofTopic<PayloadOf<"pickup.scheduled">>("pickup.scheduled").map((e) => e.payload.orderId)).toEqual(ids);
  });

  it("keeps a failed order queued and schedules it on a later pump", async () => {
    // This path needs a handler that can fail on ephemeris, which is what shows the queue retrying.
    const deps = buildDeps({ handlersDir: naiveHandlers });
    const calls = stubClients(deps);
    const good = deps.clients.ephemeris.status;
    let refuse = true;
    deps.clients.ephemeris.status = async (nodeId, ctx) => (refuse ? { ok: false, error: { code: "UNAVAILABLE", message: "down", retryable: true } } : good(nodeId, ctx));
    const app = await createNaive(deps);
    apps.push(app);
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    expect(deps.bus.ofTopic("pickup.scheduled")).toHaveLength(0);
    refuse = false;
    deps.clock.advanceTo(MINUTE_MS);
    await new Promise((r) => setImmediate(r));
    expect(deps.bus.ofTopic("pickup.scheduled")).toHaveLength(1);
    expect(calls.windows).toBe(2);
  });
});

describe("return scheduling", () => {
  it("publishes return.scheduled for the next ten minutes when the node is in contact", async () => {
    const { deps } = await boot();
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    deps.clock.advanceTo(2 * ORBIT_MS);
    await deps.bus.deliver(buildWashCompleted(placed.payload.orderId, "B4"));
    const events = deps.bus.ofTopic<PayloadOf<"return.scheduled">>("return.scheduled");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ orderId: placed.payload.orderId, podId: placed.payload.podId, habitatId: "hab01", nodeId: "B", windowStart: 2 * ORBIT_MS, windowEnd: 2 * ORBIT_MS + 10 * MINUTE_MS });
  });

  it("does not drop the return when scheduling it fails, and schedules it on redelivery", async () => {
    const deps = buildDeps({ handlersDir: naiveHandlers });
    stubClients(deps);
    const good = deps.clients.ephemeris.status;
    let refuse = false;
    deps.clients.ephemeris.status = async (nodeId, ctx) => (refuse ? { ok: false, error: { code: "UNAVAILABLE", message: "down", retryable: true } } : good(nodeId, ctx));
    apps.push(await createNaive(deps));
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    expect(deps.bus.ofTopic("pickup.scheduled")).toHaveLength(1);

    refuse = true;
    const wash = buildWashCompleted(placed.payload.orderId, "B4");
    const [first] = await deps.bus.deliver(wash);
    expect(first!.ok).toBe(false);
    expect(deps.bus.ofTopic("return.scheduled")).toHaveLength(0);

    // The bus redelivers the same envelope; it must still be unconsumed and try again.
    refuse = false;
    const [second] = await deps.bus.deliver(wash);
    expect(second!.ok).toBe(true);
    expect(deps.bus.ofTopic("return.scheduled")).toHaveLength(1);
  });
});

describe("cancellation and expiry", () => {
  it("cancels the assignment on order.cancelled and releases nothing when no hold is held", async () => {
    const { deps, calls, app } = await boot();
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    await deps.bus.deliver(buildOrderCancelled(placed.payload.orderId));
    expect(calls.releaseHold).toHaveLength(0);
    const rows = (await app.inject({ method: "GET", url: `/assignments/${placed.payload.orderId}`, headers: relayHeaders() })).json() as Assignment[];
    expect(rows.map((r) => r.state)).toEqual(["cancelled"]);
  });

  it("holds again at the same node and republishes pod.delivered on hold.expired after arrival", async () => {
    const { deps, calls, app } = await boot();
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    const { orderId, podId } = placed.payload;
    await app.inject({ method: "POST", url: "/callbacks/relay", headers: relayHeaders(), payload: buildCallback("collected", { orderId, podId, shuttleId: "sh1" }) });
    await app.inject({ method: "POST", url: "/callbacks/relay", headers: relayHeaders(), payload: buildCallback("delivered", { orderId, podId, shuttleId: "sh1", nodeId: "B", atMs: 700 }) });
    const first = deps.bus.ofTopic<PayloadOf<"pod.delivered">>("pod.delivered");
    expect(first).toHaveLength(1);
    deps.clock.advanceTo(ORBIT_MS);
    await deps.bus.deliver(buildHoldExpired({ holdId: first[0]!.payload.holdId, washerId: "B1", orderId }));
    expect(calls.acquireHold).toEqual(["B", "B"]);
    expect(calls.releaseHold).toHaveLength(0);
    const events = deps.bus.ofTopic<PayloadOf<"pod.delivered">>("pod.delivered");
    expect(events).toHaveLength(2);
    expect(events[1]!.payload.holdId).not.toBe(first[0]!.payload.holdId);
    expect(events[1]!.payload).toMatchObject({ nodeId: "B", deliveredAt: 700 });
    const after = (await app.inject({ method: "GET", url: `/assignments/${orderId}`, headers: relayHeaders() })).json() as Assignment[];
    expect(after).toHaveLength(1);
    expect(after[0]!.holdId).toBe(events[1]!.payload.holdId);
  });
});

describe("giving up", () => {
  // This path needs a handler that can fail on ephemeris, so that its attempts can run out.
  async function bootRefusing(refusals: number) {
    const deps = buildDeps({ handlersDir: naiveHandlers });
    const calls = stubClients(deps);
    const good = deps.clients.ephemeris.status;
    let left = refusals;
    deps.clients.ephemeris.status = async (nodeId, ctx) =>
      left-- > 0 ? { ok: false as const, error: { code: "UNAVAILABLE" as const, message: "ephemeris is dark", retryable: true } } : good(nodeId, ctx);
    const app = await createNaive(deps);
    apps.push(app);
    return { deps, calls, app };
  }

  /** One attempt per pump tick; the first was spent on the delivery itself. */
  async function tick(deps: { clock: { advanceTo(ms: number): void } }, minute: number) {
    deps.clock.advanceTo(minute * MINUTE_MS);
    await new Promise((r) => setImmediate(r));
  }

  it("publishes one pickup.failed carrying the reason and the attempt count when the attempts run out", async () => {
    const { deps } = await bootRefusing(Number.MAX_SAFE_INTEGER);
    const placed = buildOrderPlaced();
    await deps.bus.deliver(placed);
    for (let minute = 1; minute < MAX_ATTEMPTS; minute++) await tick(deps, minute);

    const failed = deps.bus.ofTopic<PayloadOf<"pickup.failed">>("pickup.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.tenantId).toBe("op1");
    expect(failed[0]!.payload).toMatchObject({ orderId: placed.payload.orderId, podId: placed.payload.podId, habitatId: "hab01", attempts: MAX_ATTEMPTS });
    expect(failed[0]!.payload.reason).toContain("ephemeris is dark");
    expect(deps.bus.ofTopic("pickup.scheduled")).toHaveLength(0);

    // The order is terminal now: later ticks neither retry it nor announce it a second time.
    for (let minute = MAX_ATTEMPTS; minute < MAX_ATTEMPTS + 3; minute++) await tick(deps, minute);
    expect(deps.bus.ofTopic("pickup.failed")).toHaveLength(1);
  });

  it("publishes no pickup.failed when a transient failure is followed by a success", async () => {
    const { deps } = await bootRefusing(1);
    await deps.bus.deliver(buildOrderPlaced());
    expect(deps.bus.ofTopic("pickup.scheduled")).toHaveLength(0);
    await tick(deps, 1);
    expect(deps.bus.ofTopic("pickup.scheduled")).toHaveLength(1);
    expect(deps.bus.ofTopic("pickup.failed")).toHaveLength(0);
  });
});
