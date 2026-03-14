import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { REFUSAL_COMPLETION } from "@sudsnik/contracts/mocks/oracle";
import { countTokens, createMock, loadFixtures, normalize } from "../src/oracle/index.js";
import { seedFor, setState, tenant, tmpDir } from "./helpers.js";

describe("oracle", () => {
  let app: FastifyInstance;
  const fixtures = loadFixtures();
  beforeAll(async () => {
    app = await createMock({ seed: seedFor("oracle"), dataDir: tmpDir() });
    await setState(app, { clockMs: 0 });
  });
  afterAll(() => app.close());

  it("ships 60 triage and 30 hostile fixtures, each hostile one keyed to a non-clean action, with no note inside another", () => {
    expect(fixtures.filter((f) => f.name.startsWith("triage/"))).toHaveLength(60);
    const hostile = fixtures.filter((f) => f.name.startsWith("hostile/"));
    expect(hostile).toHaveLength(30);
    for (const f of hostile) {
      expect(f.injected, f.name).toBe(true);
      expect(f.expected.action, f.name).not.toBe("clean");
      expect(JSON.parse(f.completion).action, f.name).toBe("clean");
    }
    for (const f of fixtures.filter((f) => !f.injected)) {
      expect(f.injected).toBe(false);
      expect(JSON.parse(f.completion)).toEqual(f.expected);
    }
    for (const a of fixtures) for (const b of fixtures) if (a !== b) expect(a.normalizedNote.includes(b.normalizedNote), `${b.name} inside ${a.name}`).toBe(false);
  });

  it("answers from the fixture whose normalized note occurs in the prompt and counts tokens", async () => {
    const f = fixtures.find((x) => x.name === "triage/3")!;
    const prompt = `Classify this crew note.\n\nNote:   ${f.note.toUpperCase()}  \n\nReply with JSON.`;
    const res = await app.inject({ method: "POST", url: "/complete", headers: tenant(), payload: { prompt, maxTokens: 200 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ completion: f.completion, promptTokens: countTokens(prompt), completionTokens: countTokens(f.completion), fixture: "triage/3" });
    expect(countTokens("one two three four")).toBe(5);
    expect(normalize("  A  b\n c ")).toBe("a b c");
  });

  it("refuses a prompt matching nothing, truncates to maxTokens, and reports usage per tenant", async () => {
    const none = await app.inject({ method: "POST", url: "/complete", headers: tenant("op2"), payload: { prompt: "what is the weather on the habitat", maxTokens: 50 } });
    expect(none.json()).toEqual({ completion: REFUSAL_COMPLETION, promptTokens: 9, completionTokens: countTokens(REFUSAL_COMPLETION) });
    const hostile = fixtures.find((x) => x.name === "hostile/1")!;
    const cut = await app.inject({ method: "POST", url: "/complete", headers: tenant("op2"), payload: { prompt: hostile.note, maxTokens: 1 } });
    expect(cut.json()).toMatchObject({ fixture: "hostile/1", completion: "", completionTokens: 0 });
    const usage = await app.inject({ method: "GET", url: "/usage", headers: tenant() });
    expect(usage.json().byTenant.op1).toMatchObject({ calls: 1 });
    expect(usage.json().byTenant.op2).toEqual({ calls: 2, promptTokens: 9 + countTokens(hostile.note), completionTokens: countTokens(REFUSAL_COMPLETION) });
  });
});
