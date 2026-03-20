import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { HttpClient } from "@sudsnik/clients";
import { sendResult, type App } from "@sudsnik/infra-http";
import { err } from "@sudsnik/kernel";
import { authenticate, type Verifier } from "./auth.js";
import { copyBack, markDeprecated, upstreamHeaders } from "./headers.js";
import { type RoutingTable } from "./routing.js";
import { callUpstream } from "./upstream.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** The forward route is not a port write: the idempotency key belongs to the upstream and is passed through. */
    idempotent?: boolean;
  }
}

export const FORWARD_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
type ForwardMethod = (typeof FORWARD_METHODS)[number];

const ForwardParams = z.object({ version: z.string(), service: z.string(), "*": z.string().optional() });

export interface ForwardDeps {
  http: HttpClient;
  table: RoutingTable;
  verify: Verifier;
}

/** The public path's remainder after `/<version>/<service>`, query string included, exactly as the client sent it. */
const restOf = (url: string, version: string, service: string): string => url.slice(`/${version}/${service}`.length);

/**
 * `/:version/:service/*` needs a sibling without the wildcard because Fastify does not match `/v1/orders` against it.
 * The tenant comes from the token, so the base app's tenant check is skipped (`infra: true`) and 401 is answered here.
 */
export const registerForwardRoute = (app: App, { http, table, verify }: ForwardDeps): void => {
  // Authentication runs before routing, so a request for a service that does not exist never reaches identity.
  const handler = async (req: FastifyRequest<{ Params: z.infer<typeof ForwardParams> }>, reply: FastifyReply) => {
    const { version, service } = req.params;
    if (table.deprecated(version)) markDeprecated(reply);
    const route = table.resolve(version, service);
    if (!route) return sendResult(reply, err({ code: "NOT_FOUND", message: `no route ${version}/${service}`, retryable: false }));
    if (!table.enabled(route.service)) return sendResult(reply, err({ code: "UNAVAILABLE", message: `${route.service} disabled`, retryable: true }));
    const operator = await authenticate(req, verify);
    if (!operator.ok) return sendResult(reply, operator);
    const upstream = await callUpstream(
      http,
      {
        method: req.method as ForwardMethod,
        url: table.upstreamUrl(route, restOf(req.url, version, service)),
        kind: "internal",
        headers: upstreamHeaders(req, operator.value.operatorId),
        body: req.body,
      },
      req.ctx.correlationId,
    );
    copyBack(reply, upstream.headers);
    return reply.code(upstream.status).send(upstream.body);
  };
  app.route({
    method: [...FORWARD_METHODS],
    url: "/:version/:service/*",
    schema: { params: ForwardParams },
    config: { spanName: "path", infra: true, idempotent: false },
    handler,
  });
  app.route({
    method: [...FORWARD_METHODS],
    url: "/:version/:service",
    schema: { params: ForwardParams },
    config: { spanName: "path", infra: true, idempotent: false },
    handler,
  });
};
