import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLIC_SEED } from "@sudsnik/contracts";
import { fakeDeps } from "@sudsnik/contracts/testing";
import { createMock, loadFixtures } from "@sudsnik/external/oracle";
import { subSeed } from "@sudsnik/kernel";
import { createApp, handlersDir } from "../index.js";
import { formatEval, runEval } from "./eval.js";
import { oracleOverInject } from "./oracle.js";

const SETS = ["triage", "hostile", "all"] as const;

function setArg(argv: string[]): (typeof SETS)[number] {
  const i = argv.indexOf("--set");
  const value = i >= 0 ? argv[i + 1] : "triage";
  if (!SETS.includes(value as never)) throw new RangeError(`--set must be one of ${SETS.join(", ")}`);
  return value as (typeof SETS)[number];
}

/** `npm run eval [-- --set triage|hostile|all]`: the selected variant's workflow over the fixtures, against the in-process oracle mock. */
async function main(): Promise<void> {
  const set = setArg(process.argv.slice(2));
  const dataDir = mkdtempSync(join(tmpdir(), "sudsnik-support-eval-"));
  const mock = await createMock({ seed: subSeed(PUBLIC_SEED, "oracle"), dataDir });
  const deps = fakeDeps(PUBLIC_SEED, "support", { handlersDir, dataDir });
  deps.clients.oracle = oracleOverInject(mock);
  const app = await createApp(deps);
  if (!app.support) throw new Error("support app did not start; see the env_invalid log record");
  const fixtures = loadFixtures()
    .filter((f) => set === "all" || f.name.startsWith(`${set}/`))
    .map((f) => ({ name: f.name, fixtureSet: f.name.split("/")[0]!, note: f.note, ...f.expected, injected: f.injected }));
  const scores = await runEval({ fixtures, store: app.support.store, classify: app.support.workflow.classify, tenantId: "op1" });
  console.log(formatEval(scores));
  await app.sudsnik.drain();
  await mock.close();
}

await main();
