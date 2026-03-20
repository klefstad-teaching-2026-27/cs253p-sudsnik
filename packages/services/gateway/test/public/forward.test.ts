import { afterEach, describe, expect, it } from "vitest";
import { CORRELATION_HEADER, DRIVER_HEADER, IDEMPOTENCY_HEADER, MINUTE_MS, SUNSET_DATE, TENANT_HEADER, parseFlags } from "@sudsnik/contracts";
import { err, sudsnikError } from "@sudsnik/kernel";
import { createApp } from "../../src/index.js";
import { VERIFY_TTL_MS } from "../../src/verify.js";
import { bearer, fakeHttp, gatewayDeps, jsonResponse, type FakeHttp, type GatewayDeps } from "../helpers.js";

describe("forward route", () => {
  let deps: GatewayDeps;
  let http: FakeHttp;
  let app: Awaited<ReturnType<typeof createApp>>;

  const boot = async (flagsOn: Parameters<typeof gatewayDeps>[0] = []) => {
    deps = gatewayDeps(flagsOn);
    http = fakeHttp();
    app = await createApp(deps, { http });
  };
  afterEach(async () => app?.sudsnik.drain());

  it("forwards POST /v1/orders to orders' /orders with body, key, correlation, driver and the token's tenant", async () => {
    await boot();
    const res = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...bearer("tok-op1"), [IDEMPOTENCY_HEADER]: "k1", [CORRELATION_HEADER]: "c1", [DRIVER_HEADER]: "1", [TENANT_HEADER]: "op4" },
      payload: { habitatId: "hab01", podId: "hab01-p001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forwarded: true });
    expect(http.calls).toHaveLength(1);
    const call = http.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${deps.env.SUDSNIK_ORDERS_URL}/orders`);
    expect(call.kind).toBe("internal");
    expect(call.body).toEqual({ habitatId: "hab01", podId: "hab01-p001" });
    expect(call.headers).toEqual({ [TENANT_HEADER]: "op1", [CORRELATION_HEADER]: "c1", [IDEMPOTENCY_HEADER]: "k1", [DRIVER_HEADER]: "1" });
    expect(call.ctx).toBeUndefined();
  });

  it("maps the remainder and query string onto the service's own resource paths", async () => {
    await boot();
    for (const [url, expected] of [
      ["/v1/orders/o1?limit=5&state=placed", `${deps.env.SUDSNIK_ORDERS_URL}/orders/o1?limit=5&state=placed`],
      ["/v1/orders/", `${deps.env.SUDSNIK_ORDERS_URL}/orders/`],
      ["/v1/support/reports", `${deps.env.SUDSNIK_SUPPORT_URL}/reports`],
      ["/v2/accounts/operators/op1", `${deps.env.SUDSNIK_ACCOUNTS_URL}/operators/op1`],
      ["/v1/tracking", `${deps.env.SUDSNIK_TRACKING_URL}/`],
    ] as const) {
      http.calls.length = 0;
      const res = await app.inject({ method: "GET", url, headers: bearer("tok-op1") });
      expect(res.statusCode, url).toBe(200);
      expect(http.calls[0]?.url, url).toBe(expected);
    }
  });

  it("forwards GET, PUT and DELETE, and omits the idempotency and driver headers the client did not send", async () => {
    await boot();
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/v1/washnodes/holds/h1", headers: bearer("tok-op2") });
      expect(res.statusCode).toBe(200);
    }
    expect(http.calls.map((c) => c.method)).toEqual(["GET", "PUT", "DELETE"]);
    for (const c of http.calls) expect(Object.keys(c.headers ?? {}).sort()).toEqual([CORRELATION_HEADER, TENANT_HEADER].sort());
  });

  it("copies the upstream status, body and content-type back, non-2xx included", async () => {
    await boot();
    http.respond = () => jsonResponse(404, { code: "NOT_FOUND", message: "no order", retryable: false });
    const missing = await app.inject({ method: "GET", url: "/v1/orders/nope", headers: bearer("tok-op1") });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "NOT_FOUND", message: "no order" });
    http.respond = () => jsonResponse(201, { orderId: "o1" }, { "content-type": "application/json; charset=utf-8", "x-upstream-only": "1" });
    const created = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...bearer("tok-op1"), [IDEMPOTENCY_HEADER]: "k" }, payload: {} });
    expect(created.statusCode).toBe(201);
    expect(created.headers["content-type"]).toContain("application/json");
    expect(created.headers["x-upstream-only"]).toBeUndefined();
    expect(created.json()).toEqual({ orderId: "o1" });
  });

  it("answers 503 UNAVAILABLE when the upstream cannot be reached and 504 when it times out", async () => {
    await boot();
    http.respond = () => err(sudsnikError("UNAVAILABLE", "connect ECONNREFUSED"));
    const down = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    http.respond = () => err(sudsnikError("TIMEOUT", "GET exceeded"));
    const slow = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(slow.statusCode).toBe(504);
    expect(slow.json()).toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("is 401 UNAUTHORIZED without a bearer token, with a malformed one, and with one identity rejects", async () => {
    await boot();
    for (const headers of [{}, { authorization: "Basic abc" }, { authorization: "Bearer" }, bearer("tok-nope")]) {
      const res = await app.inject({ method: "GET", url: "/v1/orders", headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: "UNAUTHORIZED", retryable: false });
    }
    expect(http.calls).toHaveLength(0);
  });

  it("is 503 UNAVAILABLE retryable when identity is down or answers nonsense", async () => {
    await boot();
    deps.clients.identity.verify = async () => err(sudsnikError("UNAVAILABLE", "identity 503"));
    const down = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    deps.clients.identity.verify = async () => ({ ok: true, value: { nope: 1 } as never });
    const odd = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(odd.statusCode).toBe(503);
    expect(http.calls).toHaveLength(0);
  });

  it("is 404 for an unknown service, the gateway itself, or an unknown version, before any verification", async () => {
    await boot();
    for (const url of ["/v1/laundry/x", "/v1/gateway/health", "/v3/orders"]) {
      const res = await app.inject({ method: "GET", url, headers: bearer("tok-op1") });
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(deps.verifyCalls).toHaveLength(0);
    expect(http.calls).toHaveLength(0);
  });

  it("is 503 '<service> disabled' when the service's flag is off", async () => {
    await boot();
    deps.flags = parseFlags("dispatch.enabled");
    app = await createApp(deps, { http });
    const res = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "UNAVAILABLE", message: "orders disabled", retryable: true });
    expect((await app.inject({ method: "GET", url: "/v1/dispatch/assignments/o1", headers: bearer("tok-op1") })).statusCode).toBe(200);
  });

  it("carries Deprecation and Sunset on every /v1 response once api.v2 is on, and never on /v2", async () => {
    await boot(["api.v2"]);
    const ok = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(ok.headers["deprecation"]).toBe("true");
    expect(ok.headers["sunset"]).toBe(SUNSET_DATE);
    const denied = await app.inject({ method: "GET", url: "/v1/orders" });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers["deprecation"]).toBe("true");
    const v2 = await app.inject({ method: "GET", url: "/v2/orders", headers: bearer("tok-op1") });
    expect(v2.statusCode).toBe(200);
    expect(v2.headers["deprecation"]).toBeUndefined();
    expect(v2.headers["sunset"]).toBeUndefined();
  });

  it("does not mark /v1 while api.v2 is off, but relays deprecation headers the upstream set", async () => {
    await boot();
    const plain = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(plain.headers["deprecation"]).toBeUndefined();
    http.respond = () => jsonResponse(200, {}, { deprecation: "true", sunset: "Tue, 01 Jun 2027 00:00:00 GMT" });
    const relayed = await app.inject({ method: "GET", url: "/v2/orders", headers: bearer("tok-op1") });
    expect(relayed.headers["deprecation"]).toBe("true");
    expect(relayed.headers["sunset"]).toBe("Tue, 01 Jun 2027 00:00:00 GMT");
  });

  it("verifies a token once per ten simulated minutes and never remembers a refusal", async () => {
    await boot();
    for (let i = 0; i < 3; i++) await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(deps.verifyCalls).toEqual(["tok-op1"]);
    await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op2") });
    expect(deps.verifyCalls).toEqual(["tok-op1", "tok-op2"]);
    deps.clock.advanceTo(VERIFY_TTL_MS - MINUTE_MS);
    await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(deps.verifyCalls).toHaveLength(2);
    deps.clock.advanceTo(VERIFY_TTL_MS);
    await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op1") });
    expect(deps.verifyCalls).toHaveLength(3);
    await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-bad") });
    await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-bad") });
    expect(deps.verifyCalls.filter((t) => t === "tok-bad")).toHaveLength(2);
  });

  it("does not replay or require an idempotency key itself: two POSTs with one key both reach the upstream", async () => {
    await boot();
    const headers = { ...bearer("tok-op1"), [IDEMPOTENCY_HEADER]: "same" };
    await app.inject({ method: "POST", url: "/v1/orders", headers, payload: { a: 1 } });
    await app.inject({ method: "POST", url: "/v1/orders", headers, payload: { a: 2 } });
    expect(http.calls.map((c) => c.body)).toEqual([{ a: 1 }, { a: 2 }]);
    const noKey = await app.inject({ method: "POST", url: "/v1/orders", headers: bearer("tok-op1"), payload: {} });
    expect(noKey.statusCode).toBe(200);
    expect(http.calls[2]?.headers?.[IDEMPOTENCY_HEADER]).toBeUndefined();
  });
});
