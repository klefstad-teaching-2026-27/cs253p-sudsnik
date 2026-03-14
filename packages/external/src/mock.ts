import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { ORBIT_MS, SIM_TOKEN_HEADER, SimStateSchema, TENANT_HEADER, type ErrorBody, type FaultEvent, type MockName, type SimState } from "@sudsnik/contracts";
import { ERROR_CODES, Rng, subSeed, type Clock, type ErrorCode } from "@sudsnik/kernel";

export type MockApp = FastifyInstance<
  import("node:http").Server,
  import("node:http").IncomingMessage,
  import("node:http").ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface MockOptions {
  /** The mock's sub-seed (system-spec §5.3), 16 hex characters. */
  seed: string;
  dataDir: string;
  /** Supplies the time before the first `/_sim/state`; after it, the latest `clockMs` wins. */
  clock?: Clock;
  /** When set, every `/_sim/*` call must carry it in `SIM_TOKEN_HEADER`; a stack sharing the loopback cannot then alter its own faults. */
  simToken?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    tenant: string;
  }
}

export interface Quota {
  /** Counts one call for the tenant in the current orbit; false once the orbit's allowance is spent. */
  take(tenant: string): boolean;
}

/** Responses the mock refused for quota, counted over the whole run; `/_sim/state` never resets them. */
export interface QuotaRefusals {
  total: number;
  byTenant: Record<string, number>;
}

/** Body of `GET /_sim/stats`: what the mock itself observed, for a grader that cannot see it from the outside. */
export interface MockStats {
  quotaRefusals: QuotaRefusals;
}

export interface Mock {
  readonly name: MockName;
  readonly app: MockApp;
  nowMs(): number;
  orbit(): number;
  /** The simulator's `dark` list plus any override the mock adds; `ground` ids are never dark. */
  isDark(id: string): boolean;
  /** Every scheduled fault of this kind addressed to this mock; `fault` is the first. */
  faults(kind: string): FaultEvent[];
  fault(kind: string): FaultEvent | undefined;
  /** `params.rate` of the fault of this kind while it is scheduled, else the mock's default. */
  rate(kind: string, fallback: number): number;
  /** One deterministic stream per purpose, so draws for one concern never shift another's. */
  rng(purpose: string): Rng;
  id(prefix: string): string;
  quota(perOrbit: () => number): Quota;
  /** Simulated seconds until the current orbit ends, for `Retry-After`. */
  secondsToNextOrbit(): number;
  /** Holds the reply open; its socket is destroyed at the next `/_sim/state` call. */
  timeout(req: FastifyRequest, reply: FastifyReply): FastifyReply;
  /** Runs after each `/_sim/state` is applied and before the simulator gets its reply. */
  onState(fn: (state: SimState) => void | Promise<void>): void;
  fail(reply: FastifyReply, code: ErrorCode, message: string, headers?: Record<string, string>): FastifyReply;
}

function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { code, message, retryable: code === "QUOTA" || code === "UNAVAILABLE" || code === "TIMEOUT" };
}

export async function createMockApp(name: MockName, opts: MockOptions): Promise<Mock> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("tenant", "");

  let state: SimState | undefined;
  const held: Array<{ req: FastifyRequest; reply: FastifyReply }> = [];
  const listeners: Array<(state: SimState) => void | Promise<void>> = [];
  const rngs = new Map<string, Rng>();

  const quotaRefusals: QuotaRefusals = { total: 0, byTenant: {} };

  const fail: Mock["fail"] = (reply, code, message, headers = {}) => {
    if (code === "QUOTA") {
      // Only the mock knows it refused; the caller may swallow the 429 and write nothing (system-spec §10.2).
      quotaRefusals.total += 1;
      const tenant = reply.request.tenant;
      quotaRefusals.byTenant[tenant] = (quotaRefusals.byTenant[tenant] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    return reply.code(ERROR_CODES[code]).send(errorBody(code, message));
  };

  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/_sim/")) {
      const given = req.headers[SIM_TOKEN_HEADER];
      if (opts.simToken && given !== opts.simToken) return fail(reply, "FORBIDDEN", `missing or wrong ${SIM_TOKEN_HEADER}`);
      return;
    }
    const raw = req.headers[TENANT_HEADER];
    const tenant = Array.isArray(raw) ? raw[0] : raw;
    if (!tenant) return fail(reply, "INVALID", `missing ${TENANT_HEADER}`);
    req.tenant = tenant;
  });

  app.setErrorHandler((error, _req, reply) => {
    const e = error as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation || e.statusCode === 400) return fail(reply, "INVALID", e.message ?? "invalid request");
    return fail(reply, "INTERNAL", e.message ?? "internal error");
  });
  app.setNotFoundHandler((req, reply) => fail(reply, "NOT_FOUND", `no route ${req.method} ${req.url}`));

  app.post("/_sim/state", { schema: { body: SimStateSchema } }, async (req) => {
    state = req.body;
    for (const h of held.splice(0)) {
      h.req.raw.socket?.destroy?.();
      h.reply.raw.destroy(new Error("timeout fault"));
    }
    for (const fn of listeners) await fn(state);
    return { ok: true };
  });

  app.get("/_sim/stats", async (): Promise<MockStats> => ({ quotaRefusals: { total: quotaRefusals.total, byTenant: { ...quotaRefusals.byTenant } } }));

  const mock: Mock = {
    name,
    app: app as MockApp,
    nowMs: () => state?.clockMs ?? opts.clock?.now() ?? 0,
    orbit: () => state?.orbit ?? Math.floor(mock.nowMs() / ORBIT_MS),
    isDark: (id) => state?.dark.includes(id) ?? false,
    faults: (kind) => state?.faults.filter((f) => f.mock === name && f.kind === kind) ?? [],
    fault: (kind) => mock.faults(kind)[0],
    rate(kind, fallback) {
      const rate = mock.fault(kind)?.params.rate;
      return typeof rate === "number" ? rate : fallback;
    },
    rng(purpose) {
      let r = rngs.get(purpose);
      if (!r) rngs.set(purpose, (r = new Rng(subSeed(opts.seed, purpose))));
      return r;
    },
    id: (prefix) => `${prefix}_${mock.rng("ids").nextU64().toString(16).padStart(16, "0").slice(0, 12)}`,
    quota(perOrbit) {
      const counts = new Map<string, number>();
      let orbit = -1;
      return {
        take(tenant) {
          if (mock.orbit() !== orbit) {
            orbit = mock.orbit();
            counts.clear();
          }
          const n = (counts.get(tenant) ?? 0) + 1;
          counts.set(tenant, n);
          return n <= perOrbit();
        },
      };
    },
    secondsToNextOrbit: () => Math.ceil((ORBIT_MS - (mock.nowMs() % ORBIT_MS)) / 1000),
    timeout(req, reply) {
      held.push({ req, reply });
      return reply;
    },
    onState: (fn) => void listeners.push(fn),
    fail,
  };
  return mock;
}

/** Simulated milliseconds a mock adds to the timestamps it stamps, never to its reply. */
export function latencyMs(mock: Mock, minMs: number, maxMs: number): number {
  return minMs + mock.rng("latency").int(maxMs - minMs + 1);
}
