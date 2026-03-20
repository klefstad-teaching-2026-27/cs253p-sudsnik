import { afterEach, describe, expect, it } from "vitest";
import { TENANT_HEADER, makeEnvelope, type Envelope } from "@sudsnik/contracts";
import type { OperatorUpdated } from "@sudsnik/contracts/events";
import { createApp } from "../../src/index.js";
import { fakeHttp, gatewayDeps, type GatewayDeps } from "../helpers.js";

const updated = (payload: OperatorUpdated, occurredAt: number, tenantId = payload.operatorId): Envelope<OperatorUpdated> =>
  makeEnvelope({ topic: "operator.updated", tenantId, occurredAt, payload });

describe("GET /operators/:operatorId/route", () => {
  let deps: GatewayDeps;
  let app: Awaited<ReturnType<typeof createApp>>;
  const boot = async () => {
    deps = gatewayDeps();
    app = await createApp(deps, { http: fakeHttp() });
  };
  afterEach(async () => app?.sudsnik.drain());

  it("answers the record operator.updated built, scoped to the tenant", async () => {
    await boot();
    const results = await deps.bus.deliver(updated({ operatorId: "op1", pricingTier: "priority", region: "eu", currency: "EUR" }, 5_000));
    expect(results).toEqual([{ ok: true, value: undefined }]);
    const own = await app.inject({ method: "GET", url: "/operators/op1/route", headers: { [TENANT_HEADER]: "op1" } });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toEqual({ operatorId: "op1", pricingTier: "priority", region: "eu", currency: "EUR", updatedAt: 5_000 });
    const other = await app.inject({ method: "GET", url: "/operators/op1/route", headers: { [TENANT_HEADER]: "op2" } });
    expect(other.statusCode).toBe(404);
    expect(other.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(deps.telemetry.logger.records.some((r) => r.event === "operator_route_updated" && r.fields.operatorId === "op1")).toBe(true);
  });

  it("needs a tenant header and is 404 for an operator never seen", async () => {
    await boot();
    expect((await app.inject({ method: "GET", url: "/operators/op1/route" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/operators/op9/route", headers: { [TENANT_HEADER]: "op9" } })).statusCode).toBe(404);
  });

  it("applies a newer update, ignores a redelivered envelope, and never lets an older one overwrite", async () => {
    await boot();
    const first = updated({ operatorId: "op2", pricingTier: "standard", region: "us", currency: "USD" }, 1_000);
    await deps.bus.deliver(first);
    await deps.bus.deliver(updated({ operatorId: "op2", pricingTier: "priority", region: "apac", currency: "AUD" }, 3_000));
    await deps.bus.deliver(first);
    await deps.bus.deliver(updated({ operatorId: "op2", pricingTier: "standard", region: "eu", currency: "EUR" }, 2_000));
    const res = await app.inject({ method: "GET", url: "/operators/op2/route", headers: { [TENANT_HEADER]: "op2" } });
    expect(res.json()).toEqual({ operatorId: "op2", pricingTier: "priority", region: "apac", currency: "AUD", updatedAt: 3_000 });
    expect(deps.bus.published).toHaveLength(0);
  });

  it("refuses a malformed payload without retrying", async () => {
    await boot();
    const [result] = await deps.bus.deliver(makeEnvelope({ topic: "operator.updated", tenantId: "op1", occurredAt: 1, payload: { operatorId: "op1", region: "mars", currency: "USD" } }));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID", retryable: false } });
  });
});
