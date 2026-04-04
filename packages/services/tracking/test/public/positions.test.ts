import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANT_HEADER } from "@sudsnik/contracts";
import type { FakeDeps } from "@sudsnik/contracts/testing";
import type { App, SudsnikApp } from "@sudsnik/infra-http";
import type { Outbox } from "@sudsnik/infra-queue";
import { checksumOf } from "../../src/checksum.js";
import { createApp } from "../../src/index.js";
import { deps as makeDeps, fakeEphemeris, positionCallback, tenant } from "../helpers.js";

/**
 * What every variant of tracking does: take a relay position callback, refuse a corrupt or foreign one, and
 * answer the fresh read from `ephemeris`. What the cached read is for costs a variant its unit band rather than
 * its correctness, so the hidden acceptance suite holds it and this one passes against every variant.
 */
describe("positions", () => {
  let deps: FakeDeps;
  let app: App & { sudsnik: SudsnikApp; outbox: Outbox };
  let ephemeris: { calls: number };
  const post = (payload: object) => app.inject({ method: "POST", url: "/callbacks/relay", payload });

  beforeAll(async () => {
    deps = makeDeps();
    ephemeris = fakeEphemeris(deps, 0.75, 9_000);
    app = await createApp(deps);
  });
  afterAll(() => app.sudsnik.drain());

  it("accepts a position callback and publishes position.updated", async () => {
    const res = await post(positionCallback("sh1", 0.5, 1_000));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: true, duplicate: false });
    expect(await app.outbox.pump()).toBe(1);
    expect(deps.bus.ofTopic("position.updated")).toHaveLength(1);
  });

  it("answers the same callback id as a duplicate", async () => {
    const res = await post(positionCallback("sh1", 0.5, 1_000));
    expect(res.json()).toEqual({ accepted: true, duplicate: true });
  });

  it("rejects a callback whose checksum does not verify with 400, and publishes nothing for it", async () => {
    const bad = { ...positionCallback("sh2", 0.5, 1_000), checksum: "00000000" };
    const res = await post(bad);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID" });
    expect(await app.outbox.pump()).toBe(0);
  });

  it("rejects a callback that is not a position", async () => {
    const collected = { kind: "collected", id: "c1", orderId: "o1", podId: "hab01-p001", shuttleId: "sh1", atMs: 0 };
    const res = await post({ ...collected, checksum: checksumOf(collected) });
    expect(res.statusCode).toBe(400);
  });

  it("serves the fresh read from ephemeris, one call per read", async () => {
    const before = ephemeris.calls;
    const fresh = await app.inject({ url: "/positions/sh1", headers: tenant() });
    expect(fresh.json()).toEqual({ shuttleId: "sh1", orbitPhase: 0.75, observedAt: 9_000, source: "fresh" });
    expect(ephemeris.calls).toBe(before + 1);
  });

  it("passes an ephemeris error through", async () => {
    deps.clients.ephemeris.position = async () => ({ ok: false, error: { code: "QUOTA", message: "quota", retryable: true } });
    const res = await app.inject({ url: "/positions/sh1", headers: { [TENANT_HEADER]: "op1" } });
    expect(res.statusCode).toBe(429);
  });
});
