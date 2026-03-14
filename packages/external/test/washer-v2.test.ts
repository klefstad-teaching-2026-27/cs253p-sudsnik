import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { HOLD_TTL_MS, WASH_CYCLE_MS } from "@sudsnik/contracts";
import { createMock } from "../src/washer-v2/index.js";
import { fault, seedFor, setState, startReceiver, tenant, tmpDir, type Receiver } from "./helpers.js";

const noFaults = [fault("washer-v2", "cycle-fault-rate", { rate: 0 })];
const hold = (app: FastifyInstance, washerId: string) => app.inject({ method: "POST", url: "/holds", headers: tenant(), payload: { washerId } });
const callbackUrl = "http://127.0.0.1:1/callbacks";

describe("washer-v2", () => {
  let relay: Receiver;
  let app: FastifyInstance;
  beforeAll(async () => {
    relay = await startReceiver();
    app = await createMock({ seed: seedFor("washer-v2"), dataDir: tmpDir(), relayUrl: relay.url });
    await setState(app, { clockMs: 0, faults: noFaults });
  });
  afterAll(async () => {
    await app.close();
    await relay.close();
  });

  it("runs a cycle and reports completion by callback through relay from the washer's node", async () => {
    const h = await hold(app, "B1");
    expect(h.statusCode).toBe(201);
    expect((await hold(app, "B1")).statusCode).toBe(409);
    const cycle = await app.inject({ method: "POST", url: "/cycles", headers: tenant(), payload: { holdId: h.json().holdId, callbackUrl } });
    expect(cycle.statusCode).toBe(201);
    expect(cycle.json()).toMatchObject({ washerId: "B1", state: "running", startedAtMs: 0, endsAtMs: WASH_CYCLE_MS });
    const id = cycle.json().cycleId;
    expect((await app.inject({ method: "GET", url: `/cycles/${id}`, headers: tenant() })).json().state).toBe("running");
    await setState(app, { clockMs: WASH_CYCLE_MS - 60_000, faults: noFaults });
    expect(relay.received).toHaveLength(0);
    await setState(app, { clockMs: WASH_CYCLE_MS, faults: noFaults });
    expect(relay.received).toHaveLength(1);
    expect(relay.received[0]).toMatchObject({ path: "/deliver", tenant: "op1", body: { origin: { kind: "node", id: "B" }, to: callbackUrl, path: "/washer" } });
    expect(relay.received[0]!.body.body).toMatchObject({ cycleId: id, washerId: "B1", state: "completed" });
    const done = (await app.inject({ method: "GET", url: `/cycles/${id}`, headers: tenant() })).json();
    expect(done.state).toBe("completed");
    expect(done.cycleUnits).toBe((relay.received[0]!.body.body as { cycleUnits: number }).cycleUnits);
    await setState(app, { clockMs: WASH_CYCLE_MS + 60_000, faults: noFaults });
    expect(relay.received).toHaveLength(1);
    expect((await hold(app, "B1")).statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/cycles/nope", headers: tenant() })).statusCode).toBe(404);
  });

  it("deletes a hold and refuses to start a cycle on an expired one", async () => {
    await setState(app, { clockMs: 0, faults: noFaults });
    const h = await hold(app, "C2");
    expect((await app.inject({ method: "DELETE", url: `/holds/${h.json().holdId}`, headers: tenant() })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/holds/${h.json().holdId}`, headers: tenant() })).statusCode).toBe(404);
    const h2 = await hold(app, "C2");
    expect(h2.statusCode).toBe(201);
    await setState(app, { clockMs: HOLD_TTL_MS, faults: noFaults });
    const late = await app.inject({ method: "POST", url: "/cycles", headers: tenant(), payload: { holdId: h2.json().holdId, callbackUrl } });
    expect(late.statusCode).toBe(409);
    expect((await hold(app, "A1")).statusCode).toBe(404);
  });

  it("faults a cycle under a cycle-fault-rate fault and says so in the callback", async () => {
    await setState(app, { clockMs: 0, faults: [fault("washer-v2", "cycle-fault-rate", { rate: 1 })] });
    const h = await hold(app, "C3");
    const cycle = await app.inject({ method: "POST", url: "/cycles", headers: tenant(), payload: { holdId: h.json().holdId, callbackUrl } });
    const before = relay.received.length;
    await setState(app, { clockMs: WASH_CYCLE_MS, faults: noFaults });
    expect(relay.received[before]!.body.body).toMatchObject({ cycleId: cycle.json().cycleId, state: "faulted" });
    expect((relay.received[before]!.body.body as { faultCode: string }).faultCode).toMatch(/^E/);
  });
});
