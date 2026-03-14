import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMock } from "../src/identity/index.js";
import { fault, seedFor, setState, tenant, tmpDir } from "./helpers.js";

describe("identity", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createMock({ seed: seedFor("identity"), dataDir: tmpDir(), tenantKeys: { op1: "key1", op2: "key2" } });
    await setState(app, { clockMs: 0, faults: [fault("identity", "error-burst", { rate: 0 })] });
  });
  afterAll(() => app.close());

  it("issues a token for the right key and verifies it", async () => {
    const wrong = await app.inject({ method: "POST", url: "/token", headers: tenant(), payload: { operatorId: "op1", key: "nope" } });
    expect(wrong.statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/token", headers: tenant(), payload: { operatorId: "op2", key: "key2" } });
    expect(res.statusCode).toBe(201);
    const { token, operatorId } = res.json();
    expect(operatorId).toBe("op2");
    const verify = await app.inject({ method: "GET", url: "/verify", headers: { ...tenant("op2"), authorization: `Bearer ${token}` } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ operatorId: "op2" });
    expect(verify.json().scopes.length).toBeGreaterThan(0);
    const unknown = await app.inject({ method: "GET", url: "/verify", headers: { ...tenant(), authorization: "Bearer nope" } });
    expect(unknown.statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/verify", headers: tenant() })).statusCode).toBe(401);
  });

  it("returns 503 on /verify under an error-burst fault", async () => {
    await setState(app, { clockMs: 60_000, faults: [fault("identity", "error-burst", { rate: 1 })] });
    const res = await app.inject({ method: "GET", url: "/verify", headers: { ...tenant(), authorization: "Bearer x" } });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });
});
