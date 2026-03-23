import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Habitat } from "@sudsnik/contracts/services/accounts";
import { boot, get, variants, type TestApp } from "../helpers.js";

for (const [name, create] of Object.entries(variants)) {
  describe(`${name} GET /habitats/:habitatId`, () => {
    let app: TestApp;
    beforeAll(async () => ({ app } = await boot(create)));
    afterAll(() => app.sudsnik.drain());

    it("returns a habitat of the calling operator with its canon index", async () => {
      const res = await get(app, "/habitats/hab05", "op2");
      expect(res.statusCode).toBe(200);
      const h = res.json() as Habitat;
      expect(h.habitatId).toBe("hab05");
      expect(h.operatorId).toBe("op2");
      expect(h.index).toBe(4);
      expect(h.name.length).toBeGreaterThan(0);
    });

    it("is 404 for a habitat another operator owns", async () => {
      expect((await get(app, "/habitats/hab05", "op1")).statusCode).toBe(404);
    });

    it("is 404 for a habitat that does not exist", async () => {
      expect((await get(app, "/habitats/hab99", "op1")).statusCode).toBe(404);
    });
  });
}
