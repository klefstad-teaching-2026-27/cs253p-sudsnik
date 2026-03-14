import { afterAll, describe, expect, it } from "vitest";
import { MOCKS, SIM_TOKEN_HEADER } from "@sudsnik/contracts";
import { createMock } from "../src/index.js";
import { seedFor, setState, startReceiver, tenant, tmpDir } from "./helpers.js";

describe("every mock", () => {
  const closers: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const c of closers) await c();
  });

  it("returns 400 without the tenant header, accepts /_sim/state without it, and takes time from clockMs", async () => {
    const relay = await startReceiver();
    closers.push(relay.close);
    for (const name of MOCKS) {
      const app = await createMock[name]({ seed: seedFor(name), dataDir: tmpDir(), tenantKeys: { op1: "k1" }, relayUrl: relay.url });
      closers.push(() => app.close());
      const bare = await app.inject({ method: "GET", url: "/anything" });
      expect(bare.statusCode, name).toBe(400);
      expect(bare.json()).toMatchObject({ code: "INVALID", retryable: false });
      expect(await setState(app, { clockMs: 123_000 }), name).toBe(200);
      const bad = await app.inject({ method: "POST", url: "/_sim/state", payload: { clockMs: -1 } });
      expect(bad.statusCode, name).toBe(400);
    }
  });

  it("refuses every /_sim route without the simulator token once one is set, and serves it with the token", async () => {
    const relay = await startReceiver();
    closers.push(relay.close);
    for (const name of MOCKS) {
      const app = await createMock[name]({ seed: seedFor(name), dataDir: tmpDir(), tenantKeys: { op1: "k1" }, relayUrl: relay.url, simToken: "s3cret" });
      closers.push(() => app.close());
      expect(await setState(app, { clockMs: 1000 }), name).toBe(403);
      const wrong = await app.inject({ method: "GET", url: "/_sim/stats", headers: { [SIM_TOKEN_HEADER]: "nope" } });
      expect(wrong.statusCode, name).toBe(403);
      expect(wrong.json()).toMatchObject({ code: "FORBIDDEN", retryable: false });
      const ok = await app.inject({ method: "GET", url: "/_sim/stats", headers: { [SIM_TOKEN_HEADER]: "s3cret" } });
      expect(ok.statusCode, name).toBe(200);
      const state = await app.inject({ method: "POST", url: "/_sim/state", headers: { [SIM_TOKEN_HEADER]: "s3cret" }, payload: { clockMs: 1000, orbit: 0, dark: [], faults: [] } });
      expect(state.statusCode, name).toBe(200);
      // The tenant routes are untouched: the token guards the simulator's surface, not the provider's.
      expect((await app.inject({ method: "GET", url: "/anything" })).statusCode, name).toBe(400);
    }
  });

  it("serves /_sim/stats without the tenant header, reporting no refusals where nothing was refused", async () => {
    const relay = await startReceiver();
    closers.push(relay.close);
    for (const name of MOCKS) {
      const app = await createMock[name]({ seed: seedFor(name), dataDir: tmpDir(), tenantKeys: { op1: "k1" }, relayUrl: relay.url });
      closers.push(() => app.close());
      await setState(app, { clockMs: 0 });
      for (let i = 0; i < 3; i++) await app.inject({ method: "GET", url: "/status?node=B", headers: tenant() });
      const res = await app.inject({ method: "GET", url: "/_sim/stats" });
      expect(res.statusCode, name).toBe(200);
      expect(res.json(), name).toEqual({ quotaRefusals: { total: 0, byTenant: {} } });
    }
  });

  it("stamps simulated time from the latest clockMs and never from the wall clock", async () => {
    const app = await createMock.ephemeris({ seed: seedFor("ephemeris"), dataDir: tmpDir(), tenantKeys: {}, relayUrl: "" });
    closers.push(() => app.close());
    const before = await app.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant() });
    expect(before.json().atMs).toBe(0);
    await setState(app, { clockMs: 42_000 });
    const after = await app.inject({ method: "GET", url: "/position?shuttle=sh1", headers: tenant() });
    expect(after.json().atMs).toBe(42_000);
  });
});
