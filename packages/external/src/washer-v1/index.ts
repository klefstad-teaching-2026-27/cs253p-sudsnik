import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { CYCLE_FAULT_RATE } from "@sudsnik/contracts";
import { HoldRequest, ReleaseRequest, StartRequest, type HoldResponse, type StartResponse, type StatusResponse } from "@sudsnik/contracts/mocks/washer-v1";
import { createMockApp, type MockOptions } from "../mock.js";
import { activeHold, isBusy, placeHold, runningCycle, startCycle, washerFleet, type Washer } from "../washers.js";

export async function createMock(opts: MockOptions): Promise<FastifyInstance> {
  const mock = await createMockApp("washer-v1", opts);
  const { app } = mock;
  const fleet = washerFleet("v1");

  /** Resolves the washer, or answers: 404 for an unknown id, a held reply while its node is dark (system-spec §10.3). */
  const locate = (id: string, req: FastifyRequest, reply: FastifyReply): Washer | FastifyReply => {
    const w = fleet.get(id);
    if (!w) return mock.fail(reply, "NOT_FOUND", `no washer ${id}`);
    if (mock.isDark(w.node)) return mock.timeout(req, reply);
    return w;
  };
  const isReply = (x: Washer | FastifyReply): x is FastifyReply => !("washerId" in x);

  const status = (w: Washer): StatusResponse => {
    const now = mock.nowMs();
    const running = runningCycle(w, now);
    if (running) return { washer: w.washerId, state: "washing", cycleId: running.cycleId };
    if (activeHold(w, now)) return { washer: w.washerId, state: "held" };
    const c = w.cycle;
    if (!c) return { washer: w.washerId, state: "idle" };
    return c.outcome.state === "faulted"
      ? { washer: w.washerId, state: "faulted", cycleId: c.cycleId, faultCode: c.outcome.faultCode }
      : { washer: w.washerId, state: "done", cycleId: c.cycleId, cycleUnits: c.outcome.cycleUnits };
  };

  app.post("/hold", { schema: { body: HoldRequest } }, async (req, reply) => {
    const w = locate(req.body.washer, req, reply);
    if (isReply(w)) return w;
    if (isBusy(w, mock.nowMs())) return mock.fail(reply, "CONFLICT", `washer ${w.washerId} is ${status(w).state}`);
    const hold = placeHold(mock, w, "h1");
    const body: HoldResponse = { holdToken: hold.holdId, washer: w.washerId, expiresAtMs: hold.expiresAtMs };
    // A v1 hold lives in the washer's own memory and is sometimes gone before the start arrives. The token is
    // issued either way and nothing says the hold has lapsed, which is what makes the silent expiry silent.
    if (mock.rng("faults").chance(mock.rate("hold-drop-rate", 0))) w.hold = undefined;
    return reply.code(201).send(body);
  });

  app.get("/status/:washer", { schema: { params: z.object({ washer: z.string() }) } }, async (req, reply) => {
    const w = locate(req.params.washer, req, reply);
    return isReply(w) ? w : status(w);
  });

  app.post("/start", { schema: { body: StartRequest } }, async (req, reply) => {
    const w = locate(req.body.washer, req, reply);
    if (isReply(w)) return w;
    const hold = activeHold(w, mock.nowMs());
    if (!hold || hold.holdId !== req.body.holdToken) return mock.fail(reply, "CONFLICT", "no active hold for that token");
    const cycle = startCycle(mock, w, mock.rate("cycle-fault-rate", CYCLE_FAULT_RATE.v1));
    const body: StartResponse = { cycleId: cycle.cycleId, startedAtMs: cycle.startedAtMs };
    return reply.code(201).send(body);
  });

  app.post("/release", { schema: { body: ReleaseRequest } }, async (req, reply) => {
    const w = locate(req.body.washer, req, reply);
    if (isReply(w)) return w;
    const hold = activeHold(w, mock.nowMs());
    const released = hold !== undefined && hold.holdId === req.body.holdToken;
    if (released) w.hold = undefined;
    return { released };
  });

  return app;
}
