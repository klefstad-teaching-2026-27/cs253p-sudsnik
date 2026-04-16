import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAIN_TAIL_ORBITS, MINUTE_MS, ORBIT_MINUTES, OracleJsonSchema, makeEnvelope, type Envelope } from "@sudsnik/contracts";
import type { DeliverRequest } from "@sudsnik/contracts/mocks/relay";
import { describe, expect, it } from "vitest";
import { scenarios } from "../src/scenarios/index.js";
import { SIM_TOKEN_HEADER } from "@sudsnik/contracts";
import { createServer } from "../src/server.js";
import { createSim } from "../src/sim.js";

function fakeBus() {
  const messages: Array<Envelope & { seq: number; publisher: string }> = [];
  return {
    messages,
    forService: (service: string) => ({
      async publish(e: Envelope) {
        messages.push({ ...e, seq: messages.length + 1, publisher: service });
      },
      subscribe: () => () => undefined,
    }),
    readAll: (topic?: string, afterSeq = 0) => messages.filter((m) => m.seq > afterSeq && (!topic || m.topic === topic)),
    deadLetters: () => [],
  };
}

function setup() {
  const bus = fakeBus();
  const delivered: DeliverRequest[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "sim-"));
  const sim = createSim({
    bus,
    postState: async () => undefined,
    deliver: async (req) => {
      delivered.push(req);
      return true;
    },
    urls: { dispatch: "http://d", tracking: "http://t" },
    seed: "00000000c0ffee00",
    dataDir,
    clockRate: 600,
    mocks: ["relay"],
  });
  return { bus, delivered, dataDir, sim };
}

describe("createSim", () => {
  it("ticks idle, then runs a scenario whose orbit 0 starts at the next tick, reads the bus, and writes oracle.json at the end of the drain", async () => {
    const { bus, delivered, dataDir, sim } = setup();
    await sim.ticker.tick();
    await sim.ticker.tick();
    expect(sim.clock()).toEqual({ nowMs: MINUTE_MS, orbit: 0, orbitPhase: 1 / ORBIT_MINUTES, running: false });
    expect(sim.status().scenario).toBeUndefined();

    const staged = sim.run({ scenario: "storm", scale: 1 });
    expect(staged.faults.length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(readFileSync(join(dataDir, "sim", "faults.json"), "utf8")).events).toEqual(staged.faults);
    expect(() => sim.run({ scenario: "storm", scale: 1 })).toThrow("already running");
    await sim.ticker.tick();
    const run = sim.currentRun()!;
    expect(run.startMs).toBe(2 * MINUTE_MS);
    expect(sim.status()).toMatchObject({ scenario: "storm", phase: "placing", orbit: 0 });

    await bus.forService("orders").publish(makeEnvelope({ topic: "order.placed", tenantId: "op1", occurredAt: run.startMs, payload: { orderId: "o1", habitatId: "hab01", podId: "hab01-p001", requestedAt: run.startMs } }));
    await bus.forService("dispatch").publish(makeEnvelope({ topic: "pickup.scheduled", tenantId: "op1", occurredAt: run.startMs, payload: { orderId: "o1", podId: "hab01-p001", habitatId: "hab01", nodeId: "A", shuttleId: "sh1", windowStart: 3 * MINUTE_MS, windowEnd: 9 * MINUTE_MS } }));
    await sim.ticker.tick();
    expect(run.events.map((e) => e.topic)).toEqual(["order.placed", "pickup.scheduled"]);
    expect(delivered.some((d) => d.body.kind === "collected")).toBe(true);
    expect(sim.status().ordersByState.scheduled).toBe(1);

    const total = (run.scenario.orbits + DRAIN_TAIL_ORBITS) * ORBIT_MINUTES;
    for (let i = 0; i < total; i++) await sim.ticker.tick();
    expect(run.phase).toBe("done");
    const written = OracleJsonSchema.parse(JSON.parse(readFileSync(sim.oraclePath(), "utf8")));
    expect(written.ordersPlaced).toBe(1);
    expect(written.invariants.no_stuck_orders).toMatchObject({ pass: false });
    expect(written.faults).toEqual(staged.faults);
    expect(sim.status().faultsInjected).toEqual(staged.faults);
    expect(bus.messages.filter((m) => m.topic === "clock.tick" && m.publisher === "sim").length).toBe(total + 4);
  });

  it("serves /clock, /run, /status, and /finish", async () => {
    const { sim } = setup();
    const guarded = createServer(sim, "t0ken");
    expect((await guarded.inject({ method: "POST", url: "/run", payload: { scenario: "quiet-orbit" } })).statusCode).toBe(403);
    expect((await guarded.inject({ method: "POST", url: "/finish", payload: {} })).statusCode).toBe(403);
    expect((await guarded.inject({ method: "POST", url: "/finish?x=1", payload: {} })).statusCode).toBe(403);
    expect((await guarded.inject({ method: "GET", url: "/clock" })).statusCode).toBe(200);
    expect((await guarded.inject({ method: "POST", url: "/finish", payload: {}, headers: { [SIM_TOKEN_HEADER]: "t0ken" } })).statusCode).toBe(409);
    const app = createServer(sim);
    await sim.ticker.tick();
    expect((await app.inject({ method: "GET", url: "/clock" })).json()).toMatchObject({ nowMs: 0, running: false });
    expect((await app.inject({ method: "POST", url: "/finish", payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/run", payload: { scenario: "nope" } })).statusCode).toBe(400);
    const run = await app.inject({ method: "POST", url: "/run", payload: { scenario: "dark-side", extraFaults: [{ atOrbit: 1, mock: "identity", kind: "error-burst", params: { rate: 0.5 } }] } });
    expect(run.statusCode).toBe(202);
    expect(run.json().faults).toHaveLength(scenarios["dark-side"].faults.events.length + 1);
    expect((await app.inject({ method: "POST", url: "/run", payload: { scenario: "dark-side" } })).statusCode).toBe(409);
    await sim.ticker.tick();
    expect((await app.inject({ method: "GET", url: "/status" })).json()).toMatchObject({ scenario: "dark-side", orbit: 0, phase: "placing" });
    const finish = await app.inject({ method: "POST", url: "/finish", payload: { alerts: [], readyTimeline: [], deadLetters: 3, fixtures: [] } });
    expect(finish.statusCode).toBe(200);
    expect(OracleJsonSchema.parse(finish.json()).invariants).toHaveProperty("no_double_launch");
    expect(existsSync(sim.oraclePath())).toBe(true);
    await app.close();
  });
});
