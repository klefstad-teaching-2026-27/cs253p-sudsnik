import { z } from "zod";
import { IdSchema, type Ctx } from "@sudsnik/contracts";
import type { RelayCallback } from "@sudsnik/contracts/mocks/relay";
import { PodLocation, Position, routes, type TrackingService } from "@sudsnik/contracts/services/tracking";
import { sendResult, type App } from "@sudsnik/infra-http";
import type { Result } from "@sudsnik/kernel";

export type Accepted = z.infer<typeof routes.relayCallback.response>;

/** The port plus the cached read and the relay ingest, which the routes table has and the port does not. */
export interface Tracking extends TrackingService {
  positionCached(shuttleId: string, ctx: Ctx): Promise<Result<Position>>;
  relay(body: RelayCallback, ctx: Ctx): Promise<Result<Accepted>>;
}

const shuttle = z.object({ shuttleId: IdSchema });
const pod = z.object({ podId: IdSchema });

export function registerRoutes(app: App, svc: Tracking): void {
  app.get(routes.position.path, { schema: { params: shuttle, response: { 200: Position } } }, async (req, reply) => sendResult(reply, await svc.position(req.params.shuttleId, req.ctx)));
  app.get(routes.positionCached.path, { schema: { params: shuttle, response: { 200: Position } } }, async (req, reply) => sendResult(reply, await svc.positionCached(req.params.shuttleId, req.ctx)));
  app.get(routes.positions.path, { schema: { response: { 200: routes.positions.response } } }, async (req, reply) => sendResult(reply, await svc.positions(req.ctx)));
  app.get(routes.podLocation.path, { schema: { params: pod, response: { 200: PodLocation } } }, async (req, reply) => sendResult(reply, await svc.podLocation(req.params.podId, req.ctx)));
  app.post(routes.relayCallback.path, { schema: { body: routes.relayCallback.body, response: { 200: routes.relayCallback.response } } }, async (req, reply) =>
    sendResult(reply, await svc.relay(req.body, req.ctx)),
  );
}
