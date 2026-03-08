import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CYCLE_FAULT_RATE } from "@sudsnik/contracts";
import { CreateHoldRequest, StartCycleRequest, type CycleResponse, type HoldResponse, type WasherCallback } from "@sudsnik/contracts/mocks/washer-v2";
import { createMockApp, latencyMs, type MockOptions } from "../mock.js";
import { relaySender } from "../relay-client.js";
import { activeHold, isBusy, placeHold, startCycle, washerFleet, type Cycle, type Washer } from "../washers.js";

export interface WasherV2Options extends MockOptions {
  relayUrl: string;
}

interface Tracked {
  cycle: Cycle;
  washer: Washer;
  tenant: string;
  callbackUrl: string;
  reported: boolean;
}

export async function createMock(opts: WasherV2Options): Promise<FastifyInstance> {
  const mock = await createMockApp("washer-v2", opts);
  const { app } = mock;
  const relay = relaySender(opts.relayUrl);
  const fleet = washerFleet("v2");
  const holds = new Map<string, Washer>();
  const cycles = new Map<string, Tracked>();

  const view = (t: Tracked): CycleResponse => {
    const c = t.cycle;
    const base = { cycleId: c.cycleId, washerId: c.washerId, startedAtMs: c.startedAtMs, endsAtMs: c.endsAtMs };
    if (c.endsAtMs > mock.nowMs()) return { ...base, state: "running" };
    return c.outcome.state === "faulted"
      ? { ...base, state: "faulted", faultCode: c.outcome.faultCode }
      : { ...base, state: "completed", cycleUnits: c.outcome.cycleUnits };
  };

  mock.onState(async () => {
    const now = mock.nowMs();
    for (const t of cycles.values()) {
      if (t.reported || t.cycle.endsAtMs > now) continue;
      t.reported = true;
      const o = t.cycle.outcome;
      const body: WasherCallback = {
        id: mock.id("wcb"),
        cycleId: t.cycle.cycleId,
        washerId: t.cycle.washerId,
        state: o.state,
        ...(o.state === "faulted" ? { faultCode: o.faultCode } : { cycleUnits: o.cycleUnits }),
        atMs: t.cycle.endsAtMs + latencyMs(mock, 100, 1_500),
      };
      await relay.send(t.tenant, {
        origin: { kind: "node", id: t.washer.node },
        destination: { kind: "ground", id: "washnodes" },
        to: t.callbackUrl,
        path: "/washer",
        body,
        deliverAtMs: body.atMs,
      });
    }
  });

  app.post("/holds", { schema: { body: CreateHoldRequest } }, async (req, reply) => {
    const w = fleet.get(req.body.washerId);
    if (!w) return mock.fail(reply, "NOT_FOUND", `no washer ${req.body.washerId}`);
    if (isBusy(w, mock.nowMs())) return mock.fail(reply, "CONFLICT", `washer ${w.washerId} is already held or washing`);
    const hold = placeHold(mock, w, "h2");
    holds.set(hold.holdId, w);
    const body: HoldResponse = { holdId: hold.holdId, washerId: w.washerId, expiresAtMs: hold.expiresAtMs };
    return reply.code(201).send(body);
  });

  app.delete("/holds/:id", { schema: { params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const w = holds.get(req.params.id);
    if (!w) return mock.fail(reply, "NOT_FOUND", `no hold ${req.params.id}`);
    holds.delete(req.params.id);
    if (w.hold?.holdId === req.params.id) w.hold = undefined;
    return reply.code(204).send();
  });

  app.post("/cycles", { schema: { body: StartCycleRequest } }, async (req, reply) => {
    const w = holds.get(req.body.holdId);
    if (!w) return mock.fail(reply, "NOT_FOUND", `no hold ${req.body.holdId}`);
    const hold = activeHold(w, mock.nowMs());
    if (!hold || hold.holdId !== req.body.holdId) return mock.fail(reply, "CONFLICT", `hold ${req.body.holdId} has expired`);
    holds.delete(hold.holdId);
    const cycle = startCycle(mock, w, mock.rate("cycle-fault-rate", CYCLE_FAULT_RATE.v2));
    const t: Tracked = { cycle, washer: w, tenant: req.tenant, callbackUrl: req.body.callbackUrl, reported: false };
    cycles.set(cycle.cycleId, t);
    return reply.code(201).send(view(t));
  });

  app.get("/cycles/:id", { schema: { params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const t = cycles.get(req.params.id);
    if (!t) return mock.fail(reply, "NOT_FOUND", `no cycle ${req.params.id}`);
    return view(t);
  });

  return app;
}
