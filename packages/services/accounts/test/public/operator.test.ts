import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Operator } from "@sudsnik/contracts/services/accounts";
import { boot, get, variants, type TestApp } from "../helpers.js";

for (const [name, create] of Object.entries(variants)) {
  describe(`${name} GET /operators/:operatorId`, () => {
    let app: TestApp;
    beforeAll(async () => ({ app } = await boot(create)));
    afterAll(() => app.sudsnik.drain());

    it("returns the calling operator from canon", async () => {
      const res = await get(app, "/operators/op2", "op2");
      expect(res.statusCode).toBe(200);
      expect(res.json() as Operator).toEqual({ operatorId: "op2", name: "Helios Habitat Group", pricingTier: "priority", region: "eu", currency: "EUR" });
    });

    it("is 404 for another tenant's operator", async () => {
      const res = await get(app, "/operators/op2", "op1");
      expect(res.statusCode).toBe(404);
      expect((res.json() as { code: string }).code).toBe("NOT_FOUND");
    });

    it("is 404 for an operator that does not exist", async () => {
      expect((await get(app, "/operators/op9", "op9")).statusCode).toBe(404);
    });

    it("serves the same row twice", async () => {
      const first = (await get(app, "/operators/op1", "op1")).json();
      const second = (await get(app, "/operators/op1", "op1")).json();
      expect(second).toEqual(first);
    });
  });
}
