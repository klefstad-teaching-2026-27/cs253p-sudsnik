import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LINK_WINDOW_MINUTES, MINUTE_MS, ORBIT_MS } from "@sudsnik/contracts";
import { EPHEMERIS_QUOTA_PER_ORBIT, STATUS_TTL_MS, createMock } from "../src/ephemeris/index.js";
import { fault, readStats, seedFor, setState, tenant, tmpDir } from "./helpers.js";

describe("ephemeris", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createMock({ seed: seedFor("ephemeris"), dataDir: tmpDir() });
    await setState(app, { clockMs: 0 });
  });
  afterAll(() => app.close());

  it("computes link windows from the canon schedule", async () => {
    const res = await app.inject({ method: "GET", url: "/windows?habitat=hab03", headers: tenant() });
    expect(res.statusCode).toBe(200);
    const start = 2 * 7.5 * MINUTE_MS;
    expect(res.json()).toMatchObject({
      habitatId: "hab03",
      windows: [
        { startMs: start, endMs: start + LINK_WINDOW_MINUTES * MINUTE_MS },
        { startMs: start + ORBIT_MS, endMs: start + ORBIT_MS + LINK_WINDOW_MINUTES * MINUTE_MS },
        { startMs: start + 2 * ORBIT_MS, endMs: start + 2 * ORBIT_MS + LINK_WINDOW_MINUTES * MINUTE_MS },
      ],
    });
    expect((await app.inject({ method: "GET", url: "/windows?habitat=hab99", headers: tenant() })).statusCode).toBe(404);
  });

  it("reports shuttle positions as an orbit phase", async () => {
    const res = await app.inject({ method: "GET", url: "/position?shuttle=sh4", headers: tenant() });
    expect(res.json()).toEqual({ shuttleId: "sh4", orbitPhase: 0.5, atMs: 0 });
  });

  it("serves /status from a cache for 300 simulated seconds", async () => {
    const fresh = (await app.inject({ method: "GET", url: "/status?node=B", headers: tenant() })).json();
    expect(fresh).toMatchObject({ nodeId: "B", inContact: true, cachedAtMs: 0 });
    await setState(app, { clockMs: STATUS_TTL_MS - 1000, dark: ["B"] });
    const stale = (await app.inject({ method: "GET", url: "/status?node=B", headers: tenant() })).json();
    expect(stale).toEqual(fresh);
    await setState(app, { clockMs: STATUS_TTL_MS, dark: ["B"] });
    const refreshed = (await app.inject({ method: "GET", url: "/status?node=B", headers: tenant() })).json();
    expect(refreshed).toMatchObject({ inContact: false, cachedAtMs: STATUS_TTL_MS });
  });

  it("returns 429 with Retry-After past the quota, per tenant, and honors a quota fault", async () => {
    const fresh = await createMock({ seed: seedFor("ephemeris"), dataDir: tmpDir() });
    await setState(fresh, { clockMs: 60_000 });
    for (let i = 0; i < EPHEMERIS_QUOTA_PER_ORBIT; i++) {
      expect((await fresh.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant() })).statusCode).toBe(200);
    }
    const over = await fresh.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant() });
    expect(over.statusCode).toBe(429);
    expect(over.headers["retry-after"]).toBe(String((ORBIT_MS - 60_000) / 1000));
    expect((await fresh.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant("op3") })).statusCode).toBe(200);
    await setState(fresh, { clockMs: ORBIT_MS, faults: [fault("ephemeris", "quota", { callsPerOrbit: 2 })] });
    expect((await fresh.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant() })).statusCode).toBe(200);
    expect((await fresh.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant() })).statusCode).toBe(200);
    expect((await fresh.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant() })).statusCode).toBe(429);
    await fresh.close();
  });

  it("counts every quota refusal at /_sim/stats, per tenant, and keeps the count across orbits", async () => {
    const tight = [fault("ephemeris", "quota", { callsPerOrbit: 1 })];
    const fresh = await createMock({ seed: seedFor("ephemeris"), dataDir: tmpDir() });
    await setState(fresh, { clockMs: 0, faults: tight });
    const call = (id = "op1") => fresh.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant(id) });
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(429);
    expect((await call()).statusCode).toBe(429);
    expect((await call("op2")).statusCode).toBe(200);
    expect((await call("op2")).statusCode).toBe(429);
    expect(await readStats(fresh)).toEqual({ quotaRefusals: { total: 3, byTenant: { op1: 2, op2: 1 } } });
    await setState(fresh, { clockMs: ORBIT_MS, faults: tight });
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(429);
    expect(await readStats(fresh)).toEqual({ quotaRefusals: { total: 4, byTenant: { op1: 3, op2: 1 } } });
    await fresh.close();
  });
});
