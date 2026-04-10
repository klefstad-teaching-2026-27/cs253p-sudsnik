import type { TriageWorkflow } from "@sudsnik/contracts/services/support";
import { newId } from "@sudsnik/kernel";
import type { EvalFixtureRow, Store } from "../store.js";

export interface EvalScore {
  set: string;
  fixtures: number;
  /** Fixtures the workflow answered; a failed classify counts against recall only. */
  predicted: number;
  correct: number;
  precision: number;
  recall: number;
  tokens: number;
  guarded: number;
  cleanOnInjected: number;
}

export interface EvalOptions {
  fixtures: EvalFixtureRow[];
  store: Store;
  classify: TriageWorkflow["classify"];
  tenantId: string;
}

/**
 * Copies the fixtures into `eval_fixtures`, classifies each from that copy, and scores per set the way the
 * simulator does (system-spec §7.1, §10.2): correct when category, severity, and action all match.
 */
export async function runEval(opts: EvalOptions): Promise<EvalScore[]> {
  opts.store.upsertFixtures(opts.fixtures);
  const sets = new Set(opts.fixtures.map((f) => f.fixtureSet));
  const rows = opts.store.fixtures().filter((f) => sets.has(f.fixtureSet));
  const bySet = new Map<string, EvalScore>();
  for (const row of rows) {
    let score = bySet.get(row.fixtureSet);
    if (!score) bySet.set(row.fixtureSet, (score = { set: row.fixtureSet, fixtures: 0, predicted: 0, correct: 0, precision: 0, recall: 0, tokens: 0, guarded: 0, cleanOnInjected: 0 }));
    score.fixtures++;
    const r = await opts.classify({ reportId: `eval-${row.name}`, note: row.note, tenantId: opts.tenantId }, { tenantId: opts.tenantId, correlationId: newId() });
    if (!r.ok) continue;
    score.predicted++;
    score.tokens += r.value.tokens;
    if (r.value.guarded) score.guarded++;
    if (row.injected && r.value.action === "clean") score.cleanOnInjected++;
    if (r.value.category === row.category && r.value.severity === row.severity && r.value.action === row.action) score.correct++;
  }
  for (const s of bySet.values()) {
    s.precision = s.predicted === 0 ? 0 : s.correct / s.predicted;
    s.recall = s.fixtures === 0 ? 0 : s.correct / s.fixtures;
  }
  return [...bySet.values()];
}

export function formatEval(scores: EvalScore[]): string {
  const cols = ["set", "fixtures", "predicted", "correct", "precision", "recall", "tokens", "guarded", "clean_on_injected"];
  const rows = scores.map((s) => [s.set, s.fixtures, s.predicted, s.correct, s.precision.toFixed(3), s.recall.toFixed(3), s.tokens, s.guarded, s.cleanOnInjected].map(String));
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(cols), ...rows.map(line)].join("\n");
}
