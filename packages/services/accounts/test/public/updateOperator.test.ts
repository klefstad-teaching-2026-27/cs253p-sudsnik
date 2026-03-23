import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Operator } from "@sudsnik/contracts/services/accounts";
import type { OperatorUpdated } from "@sudsnik/contracts/events";
import type { FakeDeps } from "@sudsnik/contracts/testing";
import { boot, get, put, variants, type TestApp } from "../helpers.js";

for (const [name, create] of Object.entries(variants)) {
  describe(`${name} PUT /operators/:operatorId`, () => {
    let app: TestApp;
    let deps: FakeDeps;
    beforeAll(async () => ({ app, deps } = await boot(create)));
    afterAll(() => app.sudsnik.drain());

    it("applies the patch, keeps every other field, and publishes operator.updated", async () => {
      const announced = deps.bus.ofTopic("operator.updated").length;
      deps.clock.advanceTo(5_000);
      const res = await put(app, "/operators/op1", "op1", { pricingTier: "priority" });
      expect(res.statusCode).toBe(200);
      expect(res.json() as Operator).toEqual({ operatorId: "op1", name: "Aurora Orbital Services", pricingTier: "priority", region: "us", currency: "USD" });
      expect((await get(app, "/operators/op1", "op1")).json()).toEqual(res.json());
      const events = deps.bus.ofTopic<OperatorUpdated>("operator.updated").slice(announced);
      expect(events.length).toBe(1);
      expect(events[0]!.tenantId).toBe("op1");
      expect(events[0]!.occurredAt).toBe(5_000);
      expect(events[0]!.payload).toEqual({ operatorId: "op1", pricingTier: "priority", region: "us", currency: "USD" });
    });

    it("publishes nothing on a no-op patch", async () => {
      const before = deps.bus.ofTopic("operator.updated").length;
      const res = await put(app, "/operators/op1", "op1", { region: "us", pricingTier: "priority" });
      expect(res.statusCode).toBe(200);
      expect(deps.bus.ofTopic("operator.updated").length).toBe(before);
    });

    it("publishes nothing on an empty patch", async () => {
      const before = deps.bus.ofTopic("operator.updated").length;
      expect((await put(app, "/operators/op1", "op1", {})).statusCode).toBe(200);
      expect(deps.bus.ofTopic("operator.updated").length).toBe(before);
    });

    it("replays the same response for the same idempotency key without publishing again", async () => {
      const before = deps.bus.ofTopic("operator.updated").length;
      const first = await put(app, "/operators/op3", "op3", { region: "eu" }, "same-key");
      const second = await put(app, "/operators/op3", "op3", { region: "eu" }, "same-key");
      expect(first.statusCode).toBe(200);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.json()).toEqual(first.json());
      expect(deps.bus.ofTopic("operator.updated").length).toBe(before + 1);
    });

    it("is 404 for another tenant's operator and changes nothing", async () => {
      const before = deps.bus.ofTopic("operator.updated").length;
      expect((await put(app, "/operators/op2", "op1", { region: "us" })).statusCode).toBe(404);
      expect(((await get(app, "/operators/op2", "op2")).json() as Operator).region).toBe("eu");
      expect(deps.bus.ofTopic("operator.updated").length).toBe(before);
    });

    it("rejects a value outside the enum", async () => {
      expect((await put(app, "/operators/op1", "op1", { region: "moon" })).statusCode).toBe(400);
    });

    it("rejects a key outside the patch, such as currency", async () => {
      expect((await put(app, "/operators/op1", "op1", { currency: "EUR" })).statusCode).toBe(400);
      expect(((await get(app, "/operators/op1", "op1")).json() as Operator).currency).toBe("USD");
    });
  });
}
