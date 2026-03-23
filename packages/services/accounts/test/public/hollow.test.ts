import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "@sudsnik/contracts/services/accounts";
import type { FakeDeps } from "@sudsnik/contracts/testing";
import { boot, createHollowApp, get, put, type TestApp } from "../helpers.js";

describe("hollow", () => {
  let app: TestApp;
  let deps: FakeDeps;
  beforeAll(async () => ({ app, deps } = await boot(createHollowApp)));
  afterAll(() => app.sudsnik.drain());

  it("serves the infra routes", async () => {
    for (const url of ["/health", "/ready", "/cost", "/version"]) expect((await app.inject(url)).statusCode).toBe(200);
    expect(((await app.inject("/version")).json() as { variant: string }).variant).toBe("hollow");
  });

  it("answers 501 UNAVAILABLE on every port route and publishes nothing", async () => {
    const paths = Object.values(routes).map((r) => r.path.replace(":operatorId", "op1").replace(":habitatId", "hab01"));
    for (const [i, r] of Object.values(routes).entries()) {
      const res = r.method === "PUT" ? await put(app, paths[i]!, "op1", {}) : await get(app, paths[i]!, "op1");
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({ code: "UNAVAILABLE", message: "accounts is hollow", retryable: true });
    }
    expect(deps.bus.published.length).toBe(0);
  });
});
