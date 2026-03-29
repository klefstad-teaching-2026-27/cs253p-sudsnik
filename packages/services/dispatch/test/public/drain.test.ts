import { describe, expect, it } from "vitest";
import { ORBIT_MS, type PayloadOf } from "@sudsnik/contracts";
import { ok, sudsnikError } from "@sudsnik/kernel";
import { createApp } from "../../src/index.js";
import { buildCallback, buildDeps, buildHold, buildOrderPlaced, relayHeaders, stubClients } from "../support/builders.js";

/** Yields to the event loop, which is where work blocked on a client resumes. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function until(what: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !what(); i++) await settle();
  expect(what()).toBe(true);
}

/** A hold acquisition the test releases by hand, so a sweep can be caught mid-flight. */
function blockingHolds(deps: ReturnType<typeof buildDeps>, opts: { busyFirst?: boolean } = {}) {
  const state = { reached: false, release: () => {} };
  const blocked = new Promise<void>((resolve) => (state.release = resolve));
  let busy = opts.busyFirst ?? false;
  deps.clients.washnodes.acquireHold = async (nodeId, orderId) => {
    if (busy) {
      busy = false;
      return { ok: false, error: sudsnikError("QUOTA", "no idle washer") };
    }
    state.reached = true;
    await blocked;
    return ok(buildHold({ nodeId, orderId, nowMs: deps.clock.now() }));
  };
  return state;
}

async function arrivedOrder() {
  const deps = buildDeps();
  stubClients(deps);
  const order = buildOrderPlaced();
  return { deps, order };
}

/** The pod leaves the habitat before it reaches the node; only the order-tolerant ingest takes the two out of order. */
function collected(app: { inject: (o: object) => Promise<{ statusCode: number }> }, orderId: string, podId: string) {
  return app.inject({ method: "POST", url: "/callbacks/relay", headers: relayHeaders(), payload: buildCallback("collected", { orderId, podId, shuttleId: "sh1", atMs: 100 }) });
}

describe("drain", () => {
  it("waits for the arrival started by a callback, refuses what starts after it, and publishes before the close", async () => {
    const { deps, order } = await arrivedOrder();
    const holds = blockingHolds(deps);
    const app = await createApp(deps);
    await deps.bus.deliver(order);
    const { orderId, podId } = order.payload;
    await collected(app, orderId, podId);

    const delivered = app.inject({
      method: "POST",
      url: "/callbacks/relay",
      headers: relayHeaders(),
      payload: buildCallback("delivered", { orderId, podId, shuttleId: "sh1", nodeId: "B", atMs: 200 }),
    });
    await until(() => holds.reached);

    let drained = false;
    const drain = app.sudsnik.drain().then(() => void (drained = true));
    await settle();
    expect(drained).toBe(false);

    const late = await app.inject({
      method: "POST",
      url: "/callbacks/relay",
      headers: relayHeaders(),
      payload: buildCallback("returned", { orderId, podId, shuttleId: "sh1" }),
    });
    expect(late.statusCode).toBe(503);

    holds.release();
    expect((await delivered).statusCode).toBe(200);
    await drain;
    const pd = deps.bus.ofTopic<PayloadOf<"pod.delivered">>("pod.delivered");
    expect(pd).toHaveLength(1);
    expect(pd[0]!.payload.orderId).toBe(orderId);
    expect(deps.bus.ofTopic("pod.returned")).toHaveLength(0);
  });

  it("waits for the washer sweep the clock started, which no one is awaiting", async () => {
    const { deps, order } = await arrivedOrder();
    const holds = blockingHolds(deps, { busyFirst: true });
    const app = await createApp(deps);
    await deps.bus.deliver(order);
    const { orderId, podId } = order.payload;
    await collected(app, orderId, podId);
    await app.inject({
      method: "POST",
      url: "/callbacks/relay",
      headers: relayHeaders(),
      payload: buildCallback("delivered", { orderId, podId, shuttleId: "sh1", nodeId: "B", atMs: 200 }),
    });
    expect(deps.bus.ofTopic("pod.delivered")).toHaveLength(0);

    deps.clock.advanceTo(ORBIT_MS);
    await until(() => holds.reached);

    let drained = false;
    const drain = app.sudsnik.drain().then(() => void (drained = true));
    await settle();
    expect(drained).toBe(false);

    holds.release();
    await drain;
    expect(deps.bus.ofTopic("pod.delivered")).toHaveLength(1);
  });
});
