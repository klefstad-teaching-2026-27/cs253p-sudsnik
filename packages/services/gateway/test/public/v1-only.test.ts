import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/variants/v1-only/index.js";
import { bearer, fakeHttp, gatewayDeps, type FakeHttp, type GatewayDeps } from "../helpers.js";

describe("v1-only variant", () => {
  let deps: GatewayDeps;
  let http: FakeHttp;
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeAll(async () => {
    deps = gatewayDeps();
    http = fakeHttp();
    app = await createApp(deps, { http });
  });
  afterAll(() => app.sudsnik.drain());

  const forwarded = async (url: string): Promise<string | undefined> => {
    http.calls.length = 0;
    const res = await app.inject({ method: "GET", url, headers: bearer("tok-op1") });
    expect(res.statusCode, url).toBe(200);
    return http.calls[0]?.url;
  };

  it("forwards /v1 to the one surface every service serves, resource prefix included", async () => {
    expect(await forwarded("/v1/billing/quotes/o1")).toBe(`${deps.env.SUDSNIK_BILLING_URL}/quotes/o1`);
    expect(await forwarded("/v1/orders/o1")).toBe(`${deps.env.SUDSNIK_ORDERS_URL}/orders/o1`);
    expect((await app.inject({ method: "GET", url: "/version" })).json()).toMatchObject({ variant: "v1-only" });
  });

  it("sends /v2 to that same surface, because no service serves a second one here", async () => {
    expect(await forwarded("/v2/billing/quotes/o1")).toBe(`${deps.env.SUDSNIK_BILLING_URL}/quotes/o1`);
    expect(await forwarded("/v2/orders/o1")).toBe(`${deps.env.SUDSNIK_ORDERS_URL}/orders/o1`);
    expect(await forwarded("/v2/support/reports")).toBe(`${deps.env.SUDSNIK_SUPPORT_URL}/reports`);
  });

  it("verifies a token once and remembers it, as golden does", async () => {
    deps.verifyCalls.length = 0;
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "GET", url: "/v1/orders", headers: bearer("tok-op2") });
      expect(res.statusCode).toBe(200);
    }
    expect(deps.verifyCalls).toEqual(["tok-op2"]);
  });
});
