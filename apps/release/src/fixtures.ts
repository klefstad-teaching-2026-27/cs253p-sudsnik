import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@sudsnik/cli";

export interface EvalFixture {
  note: string;
  injected: boolean;
  expected: { category: string; severity: string; action: string };
}

/** The oracle's fixture sets, which the driver draws notes from and the judge scores against. */
export function loadFixtures(): EvalFixture[] {
  const base = join(repoRoot(), "packages", "external", "src", "oracle", "fixtures");
  const out: EvalFixture[] = [];
  for (const set of ["triage", "hostile"]) {
    const dir = join(base, set);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalFixture;
      out.push({ note: j.note, injected: j.injected, expected: j.expected });
    }
  }
  return out;
}
