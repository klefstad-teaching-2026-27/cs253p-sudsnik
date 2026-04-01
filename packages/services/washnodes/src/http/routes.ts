import { z } from "zod";
import { IdempotencyHeaders, IdSchema } from "@sudsnik/contracts";
import type { WasherCallback } from "@sudsnik/contracts/mocks/washer-v2";
import { routes, type WashnodesService } from "@sudsnik/contracts/services/washnodes";
import { errorBody, sendResult, type App } from "@sudsnik/infra-http";
import { sudsnikError, type Result } from "@sudsnik/kernel";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CallbackReceipt } from "../app/cycles.js";

export interface RouteTargets {
  service: WashnodesService;
  callback(body: WasherCallback): Result<CallbackReceipt>;
}

const HoldParams = z.object({ holdId: IdSchema });
const NodeParams = z.object({ nodeId: IdSchema });

/** The port's routes and the washer callback, each answering through sendResult. */
export function registerRoutes(app: App, t: RouteTargets): void {
  app.post("/holds", { schema: { headers: IdempotencyHeaders, body: routes.acquireHold.body } }, async (req, reply) =>
    sendResult(reply, await t.service.acquireHold(req.body.nodeId, req.body.orderId, req.ctx), 201),
  );
  app.post("/holds/:holdId/release", { schema: { headers: IdempotencyHeaders, params: HoldParams, body: routes.releaseHold.body } }, async (req, reply) =>
    sendResult(reply, await t.service.releaseHold(req.params.holdId, req.body.reason, req.ctx)),
  );
  app.post("/holds/:holdId/start", { schema: { headers: IdempotencyHeaders, params: HoldParams } }, async (req, reply) =>
    sendResult(reply, await t.service.startCycle(req.params.holdId, req.ctx), 201),
  );
  app.get("/nodes/:nodeId", { schema: { params: NodeParams } }, async (req, reply) => sendResult(reply, await t.service.status(req.params.nodeId, req.ctx)));
  app.post("/callbacks/washer", { schema: { body: routes.washerCallback.body } }, async (req, reply) => sendResult(reply, t.callback(req.body)));
}

/** Every port route answering 501 UNAVAILABLE: a graceful absence, never a crash (`docs/system-spec.md` §8 rule 2). */
export function registerHollowRoutes(app: App): void {
  const hollow = async (req: FastifyRequest, reply: FastifyReply) => reply.code(501).send(errorBody(sudsnikError("UNAVAILABLE", "washnodes is hollow"), req.ctx.correlationId));
  app.post("/holds", { schema: { headers: IdempotencyHeaders, body: routes.acquireHold.body } }, hollow);
  app.post("/holds/:holdId/release", { schema: { headers: IdempotencyHeaders, params: HoldParams, body: routes.releaseHold.body } }, hollow);
  app.post("/holds/:holdId/start", { schema: { headers: IdempotencyHeaders, params: HoldParams } }, hollow);
  app.get("/nodes/:nodeId", { schema: { params: NodeParams } }, hollow);
  app.post("/callbacks/washer", { schema: { body: routes.washerCallback.body } }, hollow);
}
