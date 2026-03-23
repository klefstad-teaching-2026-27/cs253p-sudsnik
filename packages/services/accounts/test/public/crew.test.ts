import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Crew } from "@sudsnik/contracts/services/accounts";
import { boot, get, variants, type TestApp } from "../helpers.js";

for (const [name, create] of Object.entries(variants)) {
  describe(`${name} GET /habitats/:habitatId/crew`, () => {
    let app: TestApp;
    beforeAll(async () => ({ app } = await boot(create)));
    afterAll(() => app.sudsnik.drain());

    it("returns three crew members, each with two preferences", async () => {
      const res = await get(app, "/habitats/hab12/crew", "op4");
      expect(res.statusCode).toBe(200);
      const crew = res.json() as Crew[];
      expect(crew.length).toBe(3);
      for (const c of crew) {
        expect(c.habitatId).toBe("hab12");
        expect(Object.keys(c.preferences).length).toBe(2);
      }
      expect(new Set(crew.map((c) => c.crewId)).size).toBe(3);
    });

    it("is 404 for a habitat another operator owns", async () => {
      expect((await get(app, "/habitats/hab12/crew", "op1")).statusCode).toBe(404);
    });

    it("is 404 for a habitat that does not exist", async () => {
      expect((await get(app, "/habitats/hab99/crew", "op1")).statusCode).toBe(404);
    });
  });
}
