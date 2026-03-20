import type { CallOptions, HttpClient, HttpResponse } from "@sudsnik/clients";
import { parseFlags, type FlagName } from "@sudsnik/contracts";
import type { VerifyResponse } from "@sudsnik/contracts/mocks/identity";
import { fakeDeps, type FakeDeps } from "@sudsnik/contracts/testing";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import { handlersDir } from "../src/paths.js";

export const SEED = "00000000c0ffee00";

export type Respond = (call: CallOptions) => Result<HttpResponse<unknown>>;

export interface FakeHttp extends HttpClient {
  calls: CallOptions[];
  respond: Respond;
}

export const jsonResponse = (status: number, value: unknown, headers: Record<string, string> = {}): Result<HttpResponse<unknown>> =>
  status < 400
    ? ok({ status, headers: { "content-type": "application/json; charset=utf-8", ...headers }, value })
    : err({ ...sudsnikError("INVALID", "upstream error"), cause: { status, headers: { "content-type": "application/json; charset=utf-8", ...headers }, body: value } });

/** An HttpClient that records every call and answers from `respond`; no socket is opened. */
export const fakeHttp = (respond: Respond = () => jsonResponse(200, { forwarded: true })): FakeHttp => {
  const client: FakeHttp = {
    calls: [],
    respond,
    async call<T>(opts: CallOptions) {
      client.calls.push(opts);
      return client.respond(opts) as Result<HttpResponse<T>>;
    },
    async json<T>(opts: CallOptions) {
      const r = await client.call<T>(opts);
      return r.ok ? ok(r.value.value) : r;
    },
    close: async () => undefined,
  };
  return client;
};

export const TOKENS: Record<string, VerifyResponse> = { "tok-op1": { operatorId: "op1", scopes: ["orders"] }, "tok-op2": { operatorId: "op2", scopes: ["orders"] } };

export interface GatewayDeps extends FakeDeps {
  verifyCalls: string[];
}

/** Deps whose identity client knows TOKENS and counts its calls; flags default to every service on. */
export const gatewayDeps = (flagsOn: FlagName[] = []): GatewayDeps => {
  const deps = fakeDeps(SEED, "gateway", { handlersDir }) as GatewayDeps;
  deps.verifyCalls = [];
  deps.clients.identity.verify = async (token) => {
    deps.verifyCalls.push(token);
    const known = TOKENS[token];
    return known ? ok(known) : err(sudsnikError("UNAUTHORIZED", "unknown token"));
  };
  if (flagsOn.length > 0) deps.flags = parseFlags([deps.env.SUDSNIK_FLAGS, ...flagsOn].join(","));
  return deps;
};

export const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
