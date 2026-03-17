import { Agent, buildConnector, fetch as undiciFetch, type Dispatcher } from "undici";
import { CORRELATION_HEADER, DRIVER_HEADER, IDEMPOTENCY_HEADER, TENANT_HEADER, type Ctx, type ErrorBody, type Meter } from "@sudsnik/contracts";
import { withTimeout } from "@sudsnik/infra-resilience";
import { ERROR_CODES, err, newId, ok, sudsnikError, type Clock, type ErrorCode, type Result } from "@sudsnik/kernel";

export interface HttpClientOptions {
  /** The calling service; every charge is tagged with it. */
  service: string;
  meter: Meter;
  clock: Clock;
  /** Simulated milliseconds before a call fails TIMEOUT. */
  timeoutMs: { internal: number; external: number };
  /**
   * Wall-clock milliseconds before the socket is aborted. Services leave it unset: their time is the simulated
   * clock (`docs/system-spec.md` §6), and something else advances it while they wait. The release driver sets it,
   * because the clock it holds advances only between its own calls and so can never end one.
   */
  wallTimeoutMs?: number;
  /** Set by the release driver only; services never set it. */
  driver?: boolean;
}

export interface CallOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  kind: "internal" | "external";
  ctx?: Ctx;
  body?: unknown;
  headers?: Record<string, string>;
  /** Simulated ms; overrides the per-kind default. */
  timeoutMs?: number;
  /** Wall-clock ms; overrides the client's own. */
  wallTimeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  headers: Record<string, string>;
  value: T;
}

export interface HttpClient {
  call<T = unknown>(opts: CallOptions): Promise<Result<HttpResponse<T>>>;
  /** Result of the body only, for the common case. */
  json<T = unknown>(opts: CallOptions): Promise<Result<T>>;
  close(): Promise<void>;
}

/** A 502 is retried once here before the caller sees it; everything else maps straight through. */
const STATUS_TO_CODE: Record<number, ErrorCode> = { 400: "INVALID", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "QUOTA", 500: "INTERNAL", 502: "UNAVAILABLE", 503: "UNAVAILABLE", 504: "TIMEOUT" };

/**
 * One undici Agent per calling service; CONNECTION is charged once per socket the agent opens,
 * INTERNAL_CALL or EXTERNAL_CALL once per request. Timeouts are simulated milliseconds on the clock.
 */
export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const connector = buildConnector({});
  const agent = new Agent({
    connections: 16,
    connect: (connectOpts, cb) => {
      opts.meter.charge("CONNECTION", 1, { service: opts.service });
      connector(connectOpts, cb);
    },
  });
  const dispatcher: Dispatcher = agent;

  async function call<T>(c: CallOptions): Promise<Result<HttpResponse<T>>> {
    opts.meter.charge(c.kind === "internal" ? "INTERNAL_CALL" : "EXTERNAL_CALL", 1, { service: opts.service });
    const headers: Record<string, string> = { accept: "application/json", ...c.headers };
    if (c.ctx) {
      headers[TENANT_HEADER] = c.ctx.tenantId;
      headers[CORRELATION_HEADER] = c.ctx.correlationId;
      if (c.method === "POST" || c.method === "PUT") headers[IDEMPOTENCY_HEADER] = c.ctx.idempotencyKey ?? newId();
    }
    if (opts.driver) headers[DRIVER_HEADER] = "1";
    if (c.body !== undefined) headers["content-type"] = "application/json";
    const wallMs = c.wallTimeoutMs ?? opts.wallTimeoutMs;
    const attempt = (async (): Promise<Result<HttpResponse<T>>> => {
      let res: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        res = await undiciFetch(c.url, {
          method: c.method,
          headers,
          body: c.body === undefined ? undefined : JSON.stringify(c.body),
          dispatcher,
          ...(wallMs === undefined ? {} : { signal: AbortSignal.timeout(wallMs) }),
        });
      } catch (e) {
        return err(sudsnikError(abortedByDeadline(e) ? "TIMEOUT" : "UNAVAILABLE", `${c.method} ${c.url}: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}`, e));
      }
      const text = await res.text();
      const value = text === "" ? undefined : safeJson(text);
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (outHeaders[k] = v));
      if (res.ok) return ok({ status: res.status, headers: outHeaders, value: value as T });
      const body = value as Partial<ErrorBody> | undefined;
      const code: ErrorCode = body?.code && body.code in ERROR_CODES ? body.code : (STATUS_TO_CODE[res.status] ?? (res.status >= 500 ? "UNAVAILABLE" : "INVALID"));
      const e = sudsnikError(code, body?.message ?? `${c.method} ${c.url} -> ${res.status}`);
      return err({ ...e, cause: { status: res.status, headers: outHeaders, body } });
    })();
    return withTimeout(attempt, c.timeoutMs ?? opts.timeoutMs[c.kind], opts.clock, `${c.method} ${c.url}`);
  }

  return {
    call,
    async json<T>(c: CallOptions): Promise<Result<T>> {
      const r = await call<T>(c);
      return r.ok ? ok(r.value.value) : r;
    },
    close: () => agent.destroy(),
  };
}

/** An `AbortSignal.timeout` abort, as undici reports it directly or wrapped in the error it throws. */
function abortedByDeadline(e: unknown): boolean {
  const named = (x: unknown) => x instanceof Error && x.name === "TimeoutError";
  return named(e) || (e instanceof Error && named(e.cause));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
