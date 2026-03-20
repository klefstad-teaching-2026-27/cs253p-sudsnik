import type { FastifyReply, FastifyRequest } from "fastify";
import { CORRELATION_HEADER, DRIVER_HEADER, IDEMPOTENCY_HEADER, SUNSET_DATE, TENANT_HEADER } from "@sudsnik/contracts";
import { DEPRECATION_HEADER, SUNSET_HEADER } from "@sudsnik/contracts/services/gateway";

export const requestHeader = (req: FastifyRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const PASSED_UPSTREAM = [IDEMPOTENCY_HEADER, DRIVER_HEADER] as const;

/** Headers the upstream sees: the verified tenant, the correlation id, and the client's idempotency key and driver mark; never the client's own tenant header. */
export const upstreamHeaders = (req: FastifyRequest, tenantId: string): Record<string, string> => {
  const headers: Record<string, string> = { [TENANT_HEADER]: tenantId, [CORRELATION_HEADER]: req.ctx.correlationId };
  for (const name of PASSED_UPSTREAM) {
    const value = requestHeader(req, name);
    if (value !== undefined) headers[name] = value;
  }
  return headers;
};

const COPIED_BACK = ["content-type", DEPRECATION_HEADER, SUNSET_HEADER] as const;

export const copyBack = (reply: FastifyReply, upstream: Record<string, string>): void => {
  for (const name of COPIED_BACK) {
    const value = upstream[name];
    if (value !== undefined) void reply.header(name, value);
  }
};

/** system-spec §9: every /v1 response carries Deprecation and Sunset once api.v2 is on. */
export const markDeprecated = (reply: FastifyReply): void => {
  void reply.header(DEPRECATION_HEADER, "true");
  void reply.header(SUNSET_HEADER, SUNSET_DATE);
};
