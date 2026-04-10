import { describe, expect, it } from "vitest";
import { classifyByKeywords } from "../../src/workflow/keywords.js";
import { CATEGORIES } from "../../src/workflow/validate.js";
import { fixturesOf } from "../helpers.js";

describe("keywords", () => {
  it("always yields a category from the set and a well-formed severity and action", () => {
    for (const f of [...fixturesOf("triage"), ...fixturesOf("hostile")]) {
      const r = classifyByKeywords(f.note);
      expect(CATEGORIES).toContain(r.category);
      expect(["low", "medium", "high"]).toContain(r.severity);
      expect(["clean", "inspect", "quarantine", "escalate"]).toContain(r.action);
    }
    expect(classifyByKeywords("")).toEqual({ category: "other", severity: "low", action: "clean" });
  });

  it("gets the category right on most of the triage set, and is clearly worse than the oracle", () => {
    const fixtures = fixturesOf("triage");
    const categoryHits = fixtures.filter((f) => classifyByKeywords(f.note).category === f.expected.category).length;
    const exact = fixtures.filter((f) => {
      const r = classifyByKeywords(f.note);
      return r.category === f.expected.category && r.severity === f.expected.severity && r.action === f.expected.action;
    }).length;
    expect(categoryHits / fixtures.length).toBeGreaterThan(0.7);
    expect(exact / fixtures.length).toBeGreaterThan(0.4);
    expect(exact / fixtures.length).toBeLessThan(0.9);
  });
});
