import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CORRELATION_HEADER,
  IDEMPOTENCY_HEADER,
  TENANT_HEADER,
  type CostResponse,
  type Ctx,
  type ErrorBody,
  type ServiceDeps,
  type VersionResponse,
} from "@sudsnik/contracts";
import { enterEndpoint } from "@sudsnik/infra-metering";
import { httpStatus, isSudsnikError, newId, sudsnikError, type Result, type Stop, type SudsnikError } from "@sudsnik/kernel";

export type App = FastifyInstance<import("node:http").Server, import("node:http").IncomingMessage, import("node:http").ServerResponse, import("fastify").FastifyBaseLogger, ZodTypeProvider>;

declare module "fastify" {
  interface FastifyRequest {
    ctx: Ctx;
  }
  interface FastifyContextConfig {
    /** "route" names the span by the route pattern (default); "path" by the actual path, for wildcard forwards. */
    spanName?: "route" | "path";
    /** Infra routes and callbacks skip tenant and idempotency requirements. */
    infra?: boolean;
  }
}

export interface BaseAppOptions {
  deps: ServiceDeps;
  version: string;
  variant: string;
  gitSha?: string;
  contractsVersion?: string;
  /** Extra readiness condition beyond migrations having run; missing env is checked by the caller's readEnv(). */
  ready?: () => boolean | Promise<boolean>;
  cost: () => CostResponse;
  /** Which routes are public writes needing an Idempotency-Key. Default: every POST or PUT outside /callbacks/ and infra. */
  logger?: boolean;
}

export interface SudsnikApp {
  /** Registers a stop (consumer, timer) to run at drain. */
  registerStop(stop: Stop | (() => Promise<void>)): void;
  /** Stops accepting work, runs the stops in reverse order, then closes the server. */
  drain(): Promise<void>;
  setReady(ready: boolean): void;
  isReady(): boolean;
}

interface CachedResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function errorBody(e: SudsnikError, correlationId?: string): ErrorBody {
  return { code: e.code, message: e.message, retryable: e.retryable, ...(correlationId ? { correlationId } : {}) };
}

/**
 * The service boundary of system-spec §5.1: /health, /ready, /cost, /version, OpenAPI, tenant and correlation context,
 * idempotency replay, Result-to-HTTP mapping, span per request, endpoint-scoped metering, and drain.
 */
export async function createBaseApp(opts: BaseAppOptions): Promise<App & { sudsnik: SudsnikApp }> {
  const { deps } = opts;
  const app = Fastify({ logger: opts.logger ?? false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, { openapi: { info: { title: `sudsnik ${deps.service}`, version: opts.version } }, transform: jsonSchemaTransform });

  let ready = false;
  const stops: Array<Stop | (() => Promise<void>)> = [];
  const idem = new Map<string, CachedResponse>();
  // Replays are kept in the service's own table, so a restart still answers a repeated key from before it.
  const IDEM_MAX = 10_000;
  const production = deps.env.NODE_ENV === "production";

  app.decorateRequest("ctx", null as never);

  app.addHook("onRequest", async (req, reply) => {
    const cfg = req.routeOptions.config;
    const endpoint = `${req.method} ${req.routeOptions.url ?? req.url}`;
    enterEndpoint(endpoint);
    const correlationId = header(req, CORRELATION_HEADER) ?? newId();
    const tenantId = header(req, TENANT_HEADER) ?? "";
    req.ctx = { tenantId, correlationId, ...(header(req, IDEMPOTENCY_HEADER) ? { idempotencyKey: header(req, IDEMPOTENCY_HEADER) } : {}) };
    reply.header(CORRELATION_HEADER, correlationId);
    const isCallback = (req.routeOptions.url ?? "").startsWith("/callbacks/");
    if (cfg.infra || isCallback) return;
    if (!tenantId) return reply.code(401).send(errorBody(sudsnikError("UNAUTHORIZED", `missing ${TENANT_HEADER}`), correlationId));
    if ((req.method === "POST" || req.method === "PUT") && !req.ctx.idempotencyKey) {
      return reply.code(400).send(errorBody(sudsnikError("INVALID", `${req.method} needs ${IDEMPOTENCY_HEADER}`), correlationId));
    }
    if (req.ctx.idempotencyKey && (req.method === "POST" || req.method === "PUT")) {
      const cached = idem.get(idemKey(req));
      if (cached) {
        reply.header("idempotent-replayed", "true");
        for (const [k, v] of Object.entries(cached.headers)) reply.header(k, v);
        return reply.code(cached.status).send(cached.body);
      }
    }
  });

  app.addHook("onSend", async (req, reply, payload) => {
    if (req.ctx?.idempotencyKey && (req.method === "POST" || req.method === "PUT") && !req.routeOptions.config.infra && reply.statusCode < 500 && !reply.getHeader("idempotent-replayed")) {
      if (idem.size >= IDEM_MAX) idem.delete(idem.keys().next().value!);
      const headers: Record<string, string> = {};
      const ct = reply.getHeader("content-type");
      if (typeof ct === "string") headers["content-type"] = ct;
      idem.set(idemKey(req), { status: reply.statusCode, body: typeof payload === "string" ? safeJson(payload) : payload, headers });
    }
    return payload;
  });

  app.addHook("preHandler", async (req) => {
    const name = req.routeOptions.config.spanName === "path" ? `http ${req.method} ${req.url.split("?")[0]}` : `http ${req.method} ${req.routeOptions.url ?? req.url}`;
    const span = deps.telemetry.tracer.startSpan(name, { attributes: { "tenant.id": req.ctx?.tenantId ?? "", "correlation.id": req.ctx?.correlationId ?? "" } });
    (req as FastifyRequest & { span?: ReturnType<typeof span.spanContext> & { end: () => void } }).span = span as never;
  });
  app.addHook("onResponse", async (req, reply) => {
    const span = (req as FastifyRequest & { span?: { setAttribute: (k: string, v: number) => void; end: () => void } }).span;
    if (span) {
      span.setAttribute("http.status_code", reply.statusCode);
      span.end();
    }
  });

  app.setErrorHandler((error, req, reply) => {
    const correlationId = req.ctx?.correlationId;
    if (isSudsnikError(error)) return reply.code(httpStatus(error.code)).send(errorBody(error, correlationId));
    const e = error as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation || e.statusCode === 400) return reply.code(400).send(errorBody(sudsnikError("INVALID", e.message ?? "invalid request"), correlationId));
    if (e.statusCode === 404) return reply.code(404).send(errorBody(sudsnikError("NOT_FOUND", "no such route"), correlationId));
    deps.telemetry.logger.error("unhandled_error", { error: e.message, endpoint: `${req.method} ${req.url}` });
    return reply.code(500).send(errorBody(sudsnikError("INTERNAL", production ? "internal error" : (e.message ?? "internal error")), correlationId));
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send(errorBody(sudsnikError("NOT_FOUND", `no route ${req.method} ${req.url}`), req.ctx?.correlationId)));

  app.get("/health", { config: { infra: true } }, async () => ({ ok: true, service: deps.service }));
  app.get("/ready", { config: { infra: true } }, async (_req, reply) => {
    const extra = opts.ready ? await opts.ready() : true;
    const ok = ready && extra;
    return reply.code(ok ? 200 : 503).send({ ready: ok, service: deps.service });
  });
  app.get("/cost", { config: { infra: true } }, async (req, reply) => {
    if (production) {
      const auth = header(req, "authorization");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
      if (!token) return reply.code(401).send(errorBody(sudsnikError("UNAUTHORIZED", "/cost needs a bearer token in production")));
      const v = await deps.clients.identity.verify(token);
      if (!v.ok) return reply.code(httpStatus(v.error.code)).send(errorBody(v.error));
    }
    return opts.cost();
  });
  app.get("/version", { config: { infra: true } }, async (): Promise<VersionResponse> => ({
    service: deps.service,
    version: opts.version,
    contractsVersion: opts.contractsVersion ?? "1.0.0",
    variant: opts.variant,
    gitSha: opts.gitSha ?? "unknown",
  }));
  app.get("/openapi.json", { config: { infra: true } }, async () => app.swagger());

  const sudsnik: SudsnikApp = {
    registerStop: (s) => void stops.push(s),
    async drain() {
      ready = false;
      for (const s of [...stops].reverse()) await s();
      await app.close();
    },
    setReady: (r) => void (ready = r),
    isReady: () => ready,
  };
  app.decorate("sudsnik", sudsnik);
  return app as App & { sudsnik: SudsnikApp };
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function idemKey(req: FastifyRequest): string {
  return `${req.ctx.tenantId}\n${req.method} ${req.url.split("?")[0]}\n${req.ctx.idempotencyKey}`;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Sends a Result: 200 (or `status`) with the value, or the mapped error. */
export function sendResult<T>(reply: FastifyReply, r: Result<T>, status = 200): FastifyReply {
  if (r.ok) return reply.code(status).send(r.value);
  return reply.code(httpStatus(r.error.code)).send(errorBody(r.error, (reply.request as FastifyRequest).ctx?.correlationId));
}

export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}

/**
 * Listens on `port` and drains on SIGTERM: stop accepting, run the app's stops, close, then exit 0.
 * `onSigterm` lets a multi-service process (the --single mounter) own the signal instead.
 */
export async function listen(
  app: App & { sudsnik: SudsnikApp },
  port: number,
  opts: { handleSigterm?: boolean; afterDrain?: () => Promise<void> } = {},
): Promise<ServerHandle> {
  await app.listen({ port, host: "127.0.0.1" });
  const address = app.server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  // What the process owns outlives what the service owns, so it is torn down after the drain rather than as
  // one of its steps: a stop that closed the bus mid-drain would strand whatever the service still had to publish.
  const shutdown = async () => {
    await app.sudsnik.drain();
    await opts.afterDrain?.();
  };
  if (opts.handleSigterm ?? true) {
    const onTerm = () => {
      void shutdown().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onTerm);
  }
  return { port: bound, close: shutdown };
}

export { errorBody };
