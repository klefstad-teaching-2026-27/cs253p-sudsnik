import { describe, expect, it } from "vitest";
import { REFUSAL_COMPLETION } from "@sudsnik/contracts/mocks/oracle";
import { parseTriage } from "../../src/workflow/validate.js";

describe("validate", () => {
  it("accepts a bare JSON triage and one wrapped in prose", () => {
    const fields = { category: "odor", severity: "low", action: "clean" };
    expect(parseTriage(JSON.stringify(fields))).toEqual({ ok: true, value: fields });
    expect(parseTriage(`Sure! Here you go:\n${JSON.stringify({ ...fields, reason: "extra" })}\nAnything else?`)).toEqual({ ok: true, value: fields });
  });

  it("rejects prose, truncated JSON, a bad category, and the refusal", () => {
    for (const bad of ["I cannot classify this note.", '{"category":"odor","severity":"low"', '{"category":"smell","severity":"low","action":"clean"}', '{"category":"odor","severity":"urgent","action":"clean"}', "", REFUSAL_COMPLETION]) {
      const r = parseTriage(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("INVALID");
    }
  });
});
