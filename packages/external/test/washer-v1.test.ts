import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { HOLD_TTL_MS, WASH_CYCLE_MS } from "@sudsnik/contracts";
import { createMock } from "../src/washer-v1/index.js";
import { fault, seedFor, setState, tenant, tmpDir } from "./helpers.js";

const noFaults = [fault("washer-v1", "cycle-fault-rate", { rate: 0 })];
const status = (app: FastifyInstance, washer: string) => app.inject({ method: "GET", url: `/status/${washer}`, headers: tenant() });
const hold = (app: FastifyInstance, washer: string) => app.inject({ method: "POST", url: "/hold", headers: tenant(), payload: { washer } });

describe("washer-v1", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createMock({ seed: seedFor("washer-v1"), dataDir: tmpDir() });
    await setState(app, { clockMs: 0, faults: noFaults });
  });
  afterAll(() => app.close());

  it("holds, starts, is polled through washing to done, and refuses a second hold", async () => {
    const h = await hold(app, "A1");
    expect(h.statusCode).toBe(201);
    expect(h.json()).toMatchObject({ washer: "A1", expiresAtMs: HOLD_TTL_MS });
    expect((await hold(app, "A1")).statusCode).toBe(409);
    expect((await status(app, "A1")).json().state).toBe("held");
    const bad = await app.inject({ method: "POST", url: "/start", headers: tenant(), payload: { washer: "A1", holdToken: "wrong" } });
    expect(bad.statusCode).toBe(409);
    const start = await app.inject({ method: "POST", url: "/start", headers: tenant(), payload: { washer: "A1", holdToken: h.json().holdToken } });
    expect(start.statusCode).toBe(201);
    expect(start.json().startedAtMs).toBe(0);
    expect((await status(app, "A1")).json()).toMatchObject({ state: "washing", cycleId: start.json().cycleId });
    await setState(app, { clockMs: WASH_CYCLE_MS - 60_000, faults: noFaults });
    expect((await status(app, "A1")).json().state).toBe("washing");
    await setState(app, { clockMs: WASH_CYCLE_MS, faults: noFaults });
    const done = (await status(app, "A1")).json();
    expect(done).toMatchObject({ state: "done", cycleId: start.json().cycleId });
    expect(done.cycleUnits).toBeGreaterThan(0);
    expect((await hold(app, "A1")).statusCode).toBe(201);
    expect((await status(app, "B1")).statusCode).toBe(404);
  });

  it("expires a hold silently after one orbit and ignores /release on it with 200", async () => {
    await setState(app, { clockMs: 0, faults: noFaults });
    const h = await hold(app, "A2");
    await setState(app, { clockMs: HOLD_TTL_MS, faults: noFaults });
    expect((await status(app, "A2")).json().state).toBe("idle");
    const release = await app.inject({ method: "POST", url: "/release", headers: tenant(), payload: { washer: "A2", holdToken: h.json().holdToken } });
    expect(release.statusCode).toBe(200);
    expect(release.json()).toEqual({ released: false });
    const start = await app.inject({ method: "POST", url: "/start", headers: tenant(), payload: { washer: "A2", holdToken: h.json().holdToken } });
    expect(start.statusCode).toBe(409);
    const h2 = await hold(app, "A2");
    expect(h2.statusCode).toBe(201);
    const released = await app.inject({ method: "POST", url: "/release", headers: tenant(), payload: { washer: "A2", holdToken: h2.json().holdToken } });
    expect(released.json()).toEqual({ released: true });
    expect((await status(app, "A2")).json().state).toBe("idle");
  });

  it("faults the cycle under a cycle-fault-rate fault", async () => {
    await setState(app, { clockMs: 0, faults: [fault("washer-v1", "cycle-fault-rate", { rate: 1 })] });
    const h = await hold(app, "A3");
    await app.inject({ method: "POST", url: "/start", headers: tenant(), payload: { washer: "A3", holdToken: h.json().holdToken } });
    await setState(app, { clockMs: WASH_CYCLE_MS, faults: noFaults });
    const s = (await status(app, "A3")).json();
    expect(s.state).toBe("faulted");
    expect(s.faultCode).toMatch(/^E\d\d_/);
  });

  it("times out polling of a washer on a dark node", async () => {
    await setState(app, { clockMs: 0, dark: ["A"], faults: noFaults });
    const pending = status(app, "A4");
    let settled = false;
    void pending.then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    await setState(app, { clockMs: 60_000, faults: noFaults });
    await expect(pending).rejects.toThrow("timeout fault");
    expect((await status(app, "A4")).statusCode).toBe(200);
  });

  it("issues a hold token it has already forgotten under a hold-drop-rate fault, and refuses the start", async () => {
    const dropped = await createMock({ seed: seedFor("washer-v1"), dataDir: tmpDir() });
    await setState(dropped, { clockMs: 0, faults: [...noFaults, fault("washer-v1", "hold-drop-rate", { rate: 1 })] });
    const h = await hold(dropped, "A4");
    // The token comes back as if the washer were reserved. Only the next call says otherwise, which is what a
    // silent expiry looks like from the outside.
    expect(h.statusCode).toBe(201);
    expect((await status(dropped, "A4")).json().state).toBe("idle");
    const start = await dropped.inject({ method: "POST", url: "/start", headers: tenant(), payload: { washer: "A4", holdToken: h.json().holdToken } });
    expect(start.statusCode).toBe(409);
    await dropped.close();
  });
});
