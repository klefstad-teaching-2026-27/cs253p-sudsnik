import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CompleteRequest, Fixture, REFUSAL_COMPLETION, UsageResponse, type CompleteResponse } from "@sudsnik/contracts/mocks/oracle";

type Usage = z.infer<typeof UsageResponse>;
import { createMockApp, type MockOptions } from "../mock.js";

export const FIXTURE_SETS = ["triage", "hostile"] as const;
/** Tokens per whitespace-separated word; a fixed stand-in for a real tokenizer's ratio on English text. */
export const TOKENS_PER_WORD = 1.3;

export interface LoadedFixture extends Fixture {
  /** `<set>/<n>`, as reported in `CompleteResponse.fixture`. */
  name: string;
  normalizedNote: string;
}

export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function countTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words * TOKENS_PER_WORD);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const keep = Math.floor(maxTokens / TOKENS_PER_WORD);
  return keep >= words.length ? text : words.slice(0, keep).join(" ");
}

export function loadFixtures(dir = fileURLToPath(new URL("./fixtures", import.meta.url))): LoadedFixture[] {
  const out: LoadedFixture[] = [];
  for (const set of FIXTURE_SETS) {
    const files = readdirSync(join(dir, set))
      .filter((f) => f.endsWith(".json"))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    for (const file of files) {
      const fixture = Fixture.parse(JSON.parse(readFileSync(join(dir, set, file), "utf8")));
      out.push({ ...fixture, name: `${set}/${file.replace(/\.json$/, "")}`, normalizedNote: normalize(fixture.note) });
    }
  }
  return out;
}

export async function createMock(opts: MockOptions): Promise<FastifyInstance> {
  const mock = await createMockApp("oracle", opts);
  const { app } = mock;
  const fixtures = loadFixtures();
  const usage: Usage["byTenant"] = {};

  app.post("/complete", { schema: { body: CompleteRequest } }, async (req) => {
    const { prompt, maxTokens } = req.body;
    const normalizedPrompt = normalize(prompt);
    const match = fixtures.find((f) => normalizedPrompt.includes(f.normalizedNote));
    const completion = truncateToTokens(match?.completion ?? REFUSAL_COMPLETION, maxTokens);
    const body: CompleteResponse = {
      completion,
      promptTokens: countTokens(prompt),
      completionTokens: countTokens(completion),
      ...(match ? { fixture: match.name } : {}),
    };
    const u = (usage[req.tenant] ??= { promptTokens: 0, completionTokens: 0, calls: 0 });
    u.promptTokens += body.promptTokens;
    u.completionTokens += body.completionTokens;
    u.calls += 1;
    return body;
  });

  app.get("/usage", async (): Promise<Usage> => ({ byTenant: usage }));

  return app;
}
