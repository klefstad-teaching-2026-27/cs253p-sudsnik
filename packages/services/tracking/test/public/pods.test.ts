import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeEnvelope } from "@sudsnik/contracts";
import type { FakeDeps } from "@sudsnik/contracts/testing";
import type { App, SudsnikApp } from "@sudsnik/infra-http";
import { createApp } from "../../src/index.js";
import { deps as makeDeps, event, tenant } from "../helpers.js";

const pod = "hab02-p007";

describe("pod locations", () => {
  let deps: FakeDeps;
  let app: App & { sudsnik: SudsnikApp };
  const location = (t = "op1") => app.inject({ url: `/pods/${pod}`, headers: tenant(t) });

  beforeAll(async () => {
    deps = makeDeps();
    app = await createApp(deps);
  });
  afterAll(() => app.sudsnik.drain());

  it("is 404 for a pod no event has named", async () => {
    expect((await location()).statusCode).toBe(404);
  });

  it("follows scheduled, collected, delivered, and returned", async () => {
    await event(deps, "pickup.scheduled", { orderId: "o1", podId: pod, habitatId: "hab02", nodeId: "B", shuttleId: "sh2", windowStart: 100, windowEnd: 700 }, 50);
    expect((await location()).json()).toEqual({ podId: pod, kind: "habitat", id: "hab02", since: 50 });
    await event(deps, "pod.collected", { orderId: "o1", podId: pod, shuttleId: "sh2", collectedAt: 120 }, 120);
    expect((await location()).json()).toEqual({ podId: pod, kind: "shuttle", id: "sh2", since: 120 });
    await event(deps, "pod.delivered", { orderId: "o1", podId: pod, nodeId: "B", holdId: "h1", deliveredAt: 5_500 }, 5_500);
    expect((await location()).json()).toEqual({ podId: pod, kind: "node", id: "B", since: 5_500 });
    await event(deps, "wash.started", { orderId: "o1", washerId: "B3", startedAt: 5_600 }, 5_600);
    await event(deps, "return.scheduled", { orderId: "o1", podId: pod, habitatId: "hab02", nodeId: "B", shuttleId: "sh2", windowStart: 9_000, windowEnd: 9_600 }, 8_400);
    expect((await location()).json()).toEqual({ podId: pod, kind: "node", id: "B", since: 8_400 });
    await event(deps, "pod.returned", { orderId: "o1", podId: pod, shuttleId: "sh2", returnedAt: 15_000 }, 15_000);
    expect((await location()).json()).toEqual({ podId: pod, kind: "habitat", id: "hab02", since: 15_000 });
  });

  it("is 404 for another tenant", async () => {
    expect((await location("op2")).statusCode).toBe(404);
  });

  it("applies a redelivered envelope once", async () => {
    const e = makeEnvelope({ topic: "pod.collected", tenantId: "op1", occurredAt: 30_000, payload: { orderId: "o2", podId: pod, shuttleId: "sh5", collectedAt: 30_000 } });
    await deps.bus.deliver(e);
    await event(deps, "pod.delivered", { orderId: "o2", podId: pod, nodeId: "C", holdId: "h2", deliveredAt: 31_000 }, 31_000);
    const results = await deps.bus.deliver(e);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await location()).json()).toMatchObject({ kind: "node", id: "C" });
  });

  it("keeps the newer observation when an older one arrives after it", async () => {
    await event(deps, "pod.returned", { orderId: "o2", podId: pod, shuttleId: "sh5", returnedAt: 40_000 }, 40_000);
    expect((await location()).json()).toEqual({ podId: pod, kind: "habitat", id: "hab02", since: 40_000 });
    // A different envelope, so the id dedupe cannot refuse it; only the observation's own time can.
    await event(deps, "pod.collected", { orderId: "o2", podId: pod, shuttleId: "sh6", collectedAt: 35_000 }, 35_000);
    expect((await location()).json()).toEqual({ podId: pod, kind: "habitat", id: "hab02", since: 40_000 });
  });
});
