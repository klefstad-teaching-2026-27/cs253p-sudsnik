import { afterEach, describe, expect, it } from "vitest";
import type { PayloadOf } from "@sudsnik/contracts";
import { createApp } from "../../src/index.js";
import { buildCallback, buildDeps, buildOrderCancelled, buildOrderPlaced, buildWashCompleted, relayHeaders, stubClients } from "../support/builders.js";

const apps: Array<{ sudsnik: { drain(): Promise<void> } }> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.sudsnik.drain();
});

async function placed() {
  const deps = buildDeps();
  stubClients(deps);
  const app = await createApp(deps);
  apps.push(app);
  const order = buildOrderPlaced();
  await deps.bus.deliver(order);
  const orderId = order.payload.orderId;
  const podId = order.payload.podId;
  const post = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/callbacks/relay", headers: relayHeaders(), payload: body });
  return { deps, app, orderId, podId, post };
}

describe("relay ingest", () => {
  it("refuses a callback it cannot apply and publishes none of the steps before it", async () => {
    const deps = buildDeps();
    stubClients(deps);
    const app = await createApp(deps);
    const order = buildOrderPlaced();
    await deps.bus.deliver(order);
    const { orderId, podId } = order.payload;
    // Cancelling the order cancels its pickup, so a callback arriving afterwards names no node to deliver to.
    await deps.bus.deliver(buildOrderCancelled(orderId));
    const res = await app.inject({ method: "POST", url: "/callbacks/relay", headers: relayHeaders(), payload: buildCallback("returned", { orderId, podId, shuttleId: "sh2", atMs: 900 }) });
    expect(res.statusCode).toBe(409);
    // The drain's final pump publishes whatever the outbox holds, so an empty stream proves nothing was applied.
    await app.sudsnik.drain();
    expect(deps.bus.ofTopic("pod.collected")).toHaveLength(0);
    expect(deps.bus.ofTopic("pod.returned")).toHaveLength(0);
  });

  it("moves the pickup through underway and done, holds a washer on arrival, and publishes the pod events", async () => {
    const { deps, app, orderId, podId, post } = await placed();
    const collected = await post(buildCallback("collected", { orderId, podId, shuttleId: "sh1", atMs: 100 }));
    expect(collected.statusCode).toBe(200);
    expect(collected.json()).toEqual({ accepted: true, duplicate: false });
    const delivered = await post(buildCallback("delivered", { orderId, podId, shuttleId: "sh1", nodeId: "B", atMs: 200 }));
    expect(delivered.statusCode).toBe(200);

    const rows = (await app.inject({ method: "GET", url: `/assignments/${orderId}`, headers: relayHeaders() })).json() as Array<{ state: string; holdId?: string }>;
    expect(rows[0]!.state).toBe("done");
    expect(rows[0]!.holdId).toBeDefined();
    const pc = deps.bus.ofTopic<PayloadOf<"pod.collected">>("pod.collected");
    const pd = deps.bus.ofTopic<PayloadOf<"pod.delivered">>("pod.delivered");
    expect(pc).toHaveLength(1);
    expect(pc[0]!.payload).toEqual({ orderId, podId, shuttleId: "sh1", collectedAt: 100 });
    expect(pd).toHaveLength(1);
    expect(pd[0]!.payload).toEqual({ orderId, podId, nodeId: "B", holdId: rows[0]!.holdId, deliveredAt: 200 });
  });

  it("publishes pod.returned and finishes the return leg", async () => {
    const { deps, app, orderId, podId, post } = await placed();
    await post(buildCallback("collected", { orderId, podId, shuttleId: "sh1" }));
    await post(buildCallback("delivered", { orderId, podId, shuttleId: "sh1", nodeId: "B" }));
    await deps.bus.deliver(buildWashCompleted(orderId, "B1"));
    const returned = await post(buildCallback("returned", { orderId, podId, shuttleId: "sh2", atMs: 900 }));
    expect(returned.statusCode).toBe(200);
    const pr = deps.bus.ofTopic<PayloadOf<"pod.returned">>("pod.returned");
    expect(pr).toHaveLength(1);
    expect(pr[0]!.payload).toEqual({ orderId, podId, shuttleId: "sh2", returnedAt: 900 });
    const rows = (await app.inject({ method: "GET", url: `/assignments/${orderId}`, headers: relayHeaders() })).json() as Array<{ leg: string; state: string }>;
    expect(rows.map((r) => [r.leg, r.state])).toEqual([
      ["pickup", "done"],
      ["return", "done"],
    ]);
  });

  it("rejects a malformed body with 400 and an unknown order with 404", async () => {
    const { post } = await placed();
    expect((await post({ kind: "collected" })).statusCode).toBe(400);
    const unknown = await post(buildCallback("collected", { orderId: "ghost", podId: "p", shuttleId: "sh1" }));
    expect(unknown.statusCode).toBe(404);
  });

  it("acknowledges a position callback without publishing", async () => {
    const { deps, post } = await placed();
    const res = await post(buildCallback("position", { shuttleId: "sh1", orbitPhase: 0.5 }));
    expect(res.statusCode).toBe(200);
    expect(deps.bus.published.filter((e) => e.topic !== "pickup.scheduled")).toHaveLength(0);
  });
});
