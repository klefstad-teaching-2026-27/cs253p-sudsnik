import { describe, expect, it } from "vitest";
import { declaredTopics } from "@sudsnik/contracts";
import { render, stringParams, templateFor } from "../../src/templates/index.js";

describe("templates", () => {
  it("has a template for every consumed topic", () => {
    for (const topic of declaredTopics.notify.consumes) {
      const t = templateFor(topic);
      expect(t, topic).toBeDefined();
      const r = t!.render({ orderId: "o1", podId: "p1", amount: "4900", currency: "USD" });
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });

  it("renders event fields into the body", () => {
    expect(render("charge.captured", { orderId: "o1", chargeId: "c1", amount: "4900", currency: "USD" })).toEqual({ title: "Payment captured", body: "4900 USD charged for order o1 (charge c1)." });
  });

  it("renders an unknown template name as its params so send never fails on the name", () => {
    expect(render("custom", { a: "1", b: "2" })).toEqual({ title: "custom", body: "a: 1\nb: 2" });
    expect(render("custom", {})).toEqual({ title: "custom", body: "" });
  });

  it("stringifies payload fields and drops absent ones", () => {
    expect(stringParams({ orderId: "o1", amount: 4900, compensations: ["a"], gone: undefined, nil: null })).toEqual({ orderId: "o1", amount: "4900", compensations: '["a"]' });
    expect(stringParams(null)).toEqual({});
    expect(stringParams("text")).toEqual({});
  });
});
