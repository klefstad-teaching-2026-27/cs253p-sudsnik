import type { Ctx, EphemerisClient, IdentityClient, OracleClient, PaymentsClient, RelayClient, WasherV1Client, WasherV2Client } from "@sudsnik/contracts";
import { ok } from "@sudsnik/kernel";
import type { HttpClient } from "./http.js";

/** Calls that carry no tenant context (identity) still send the tenant header when one is known. */
const systemCtx: Ctx = { tenantId: "system", correlationId: "system" };

export function paymentsClient(http: HttpClient, base: string): PaymentsClient {
  const j = <T>(path: string, ctx: Ctx, body: unknown) => http.json<T>({ method: "POST", url: base + path, kind: "external", ctx, body });
  return {
    authorize: (req, ctx) => j("/authorize", ctx, req),
    capture: (paymentRef, amount, ctx) => j("/capture", ctx, { paymentRef, amount }),
    refund: (paymentRef, amount, ctx) => j("/refund", ctx, { paymentRef, amount }),
  };
}

export function ephemerisClient(http: HttpClient, base: string): EphemerisClient {
  const j = <T>(path: string, ctx: Ctx) => http.json<T>({ method: "GET", url: base + path, kind: "external", ctx });
  return {
    windows: (habitatId, ctx) => j(`/windows?habitat=${encodeURIComponent(habitatId)}`, ctx),
    position: (shuttleId, ctx) => j(`/position?shuttle=${encodeURIComponent(shuttleId)}`, ctx),
    status: (nodeId, ctx) => j(`/status?node=${encodeURIComponent(nodeId)}`, ctx),
  };
}

export function identityClient(http: HttpClient, base: string): IdentityClient {
  return {
    token: (operatorId, key) => http.json({ method: "POST", url: `${base}/token`, kind: "external", ctx: { ...systemCtx, tenantId: operatorId }, body: { operatorId, key } }),
    verify: (token) => http.json({ method: "GET", url: `${base}/verify`, kind: "external", ctx: systemCtx, headers: { authorization: `Bearer ${token}` } }),
  };
}

export function washerV1Client(http: HttpClient, base: string): WasherV1Client {
  return {
    hold: (washer, ctx) => http.json({ method: "POST", url: `${base}/hold`, kind: "external", ctx, body: { washer } }),
    status: (washer, ctx) => http.json({ method: "GET", url: `${base}/status/${encodeURIComponent(washer)}`, kind: "external", ctx }),
    start: (washer, holdToken, ctx) => http.json({ method: "POST", url: `${base}/start`, kind: "external", ctx, body: { washer, holdToken } }),
    release: async (washer, holdToken, ctx) => {
      const r = await http.call({ method: "POST", url: `${base}/release`, kind: "external", ctx, body: { washer, holdToken } });
      return r.ok ? ok(undefined) : r;
    },
  };
}

export function washerV2Client(http: HttpClient, base: string): WasherV2Client {
  return {
    createHold: (washerId, ctx) => http.json({ method: "POST", url: `${base}/holds`, kind: "external", ctx, body: { washerId } }),
    deleteHold: async (holdId, ctx) => {
      const r = await http.call({ method: "DELETE", url: `${base}/holds/${encodeURIComponent(holdId)}`, kind: "external", ctx });
      return r.ok ? ok(undefined) : r;
    },
    startCycle: (holdId, callbackUrl, ctx) => http.json({ method: "POST", url: `${base}/cycles`, kind: "external", ctx, body: { holdId, callbackUrl } }),
    cycle: (cycleId, ctx) => http.json({ method: "GET", url: `${base}/cycles/${encodeURIComponent(cycleId)}`, kind: "external", ctx }),
  };
}

export function relayClient(http: HttpClient, base: string): RelayClient {
  return {
    deliver: (req, ctx) => http.json({ method: "POST", url: `${base}/deliver`, kind: "external", ctx, body: req }),
  };
}

export function oracleClient(http: HttpClient, base: string): OracleClient {
  return {
    complete: (prompt, maxTokens, ctx) => http.json({ method: "POST", url: `${base}/complete`, kind: "external", ctx, body: { prompt, maxTokens }, timeoutMs: 30_000 }),
  };
}
