import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ENTRIES, repoRoot, spawnTs, startStack, stopAll, waitForReady, withDefaults, type RunningStack } from "@sudsnik/cli";
import { FaultScheduleSchema, PUBLIC_SEED, SCENARIOS, type FaultEvent, type ScenarioName } from "@sudsnik/contracts";
import { scenarios } from "@sudsnik/sim";
import { RESTART_DEADLINE_MS, drive } from "./driver.js";
import { loadFixtures } from "./fixtures.js";

/** Local runs sign with a fixed development key; the grader's key lives in plugins/release.py. */
export const DEV_LEDGER_KEY = "sudsnik-dev-ledger-key";
/** How long a signalled stack has to drain and exit before the run reports it did not. */
export const DRAIN_DEADLINE_MS = 60_000;
/** Under --attach, the file the driver writes to ask for a restart and the one whoever owns the stack writes when it is back. */
export const RESTART_REQUEST = "restart.json";
export const RESTART_DONE = "restart.done";

/**
 * A driver that did not start the stack cannot restart it; it asks whoever did, through the results directory the
 * two share, and waits for the answer and for /ready.
 */
async function requestRestart(resultsDir: string, readyUrl: string): Promise<{ pgid?: number }> {
  const done = resolve(resultsDir, RESTART_DONE);
  rmSync(done, { force: true });
  writeFileSync(resolve(resultsDir, RESTART_REQUEST), JSON.stringify({ requestedAt: new Date().toISOString() }));
  const deadline = Date.now() + RESTART_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (existsSync(done)) {
      // The owner names the group it started, which is the one to drain at the end.
      const answer = JSON.parse(readFileSync(done, "utf8")) as { ready?: boolean; pgid?: number };
      if (answer.ready !== false && (await waitForReady(readyUrl, deadline - Date.now()))) return { ...(answer.pgid ? { pgid: answer.pgid } : {}) };
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the stack's owner did not restart it within ${RESTART_DEADLINE_MS / 1000} s`);
}

/**
 * Signals the process group and waits for it to go. A port that stopped answering is not the same as a process
 * that exited — a wedged stack answers nothing either — so this asks the group itself, which is exact.
 */
async function drainGroup(pgid: number): Promise<{ exited: boolean }> {
  const gone = () => {
    try {
      process.kill(-pgid, 0);
      return false;
    } catch {
      return true;
    }
  };
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    return { exited: true };
  }
  const deadline = Date.now() + DRAIN_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (gone()) return { exited: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { exited: false };
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const has = (flag: string) => process.argv.includes(flag);

/** What a stack leaves in the data directory: a file per service, the bus, and the four directories they write. */
const STACK_ARTIFACTS = ["otel", "logs", "sim", "mocks"];

/**
 * Empties the data directory of what a stack wrote, and only that. `SUDSNIK_DATA_DIR` comes from the environment and
 * could name anything, so nothing is removed that the stack did not put there.
 */
function clearDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) {
    if (!STACK_ARTIFACTS.includes(entry) && !/\.sqlite(-wal|-shm)?$/.test(entry)) continue;
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const name = arg("--scenario", "quiet-orbit") as ScenarioName;
  if (!(SCENARIOS as readonly string[]).includes(name)) throw new Error(`unknown scenario ${name}; one of ${SCENARIOS.join(", ")}`);
  const scenario = scenarios[name];
  const scale = Number(arg("--scale", "1"));
  const seed = arg("--seed", PUBLIC_SEED)!;
  const single = has("--single");
  const attach = has("--attach");
  // Under --attach the stack belongs to whoever started it. The drain the lost-order invariant is judged after
  // can only happen when that owner hands over the process group to signal (`docs/system-spec.md` §10.2).
  let stackPgid = Number(arg("--stack-pgid", "")) || undefined;
  const stageName = (arg("--stage", "canary") as "canary" | "production");
  const assignment = arg("--assignment", "local")!;
  const seams = (arg("--seam") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const faultsPath = arg("--faults");
  const points = Number(arg("--points", "")) || undefined;
  const deadlineFactor = Number(arg("--deadline-factor", "")) || undefined;
  const extraFaults: FaultEvent[] = faultsPath ? FaultScheduleSchema.parse(JSON.parse(readFileSync(resolve(faultsPath), "utf8"))).events : [];

  const env = withDefaults(process.env, { single });
  // A scenario that tests a migration needs the new API switched on; the grader's manifest sets the same flags.
  if (scenario.flags?.length) {
    const on = new Set([...(env.SUDSNIK_FLAGS ?? "").split(",").map((f) => f.trim()).filter(Boolean), ...scenario.flags]);
    env.SUDSNIK_FLAGS = [...on].join(",");
  }
  // The simulator and the mocks take control calls only with this token. Under --attach whoever booted the stack
  // set it for this process and withheld it from the stack; a run that boots its own stack shares one process
  // with it and the token then only keeps the shape the grader relies on.
  if (!env.SUDSNIK_SIM_TOKEN) env.SUDSNIK_SIM_TOKEN = randomBytes(16).toString("hex");
  const resultsDir = resolve(arg("--results", "results")!);
  const children: ReturnType<typeof spawnTs>[] = [];
  let stack: RunningStack | undefined;
  const rootUrl = single ? `http://127.0.0.1:${env.SUDSNIK_PORT}` : env.SUDSNIK_GATEWAY_URL!;
  const root = repoRoot();
  const log = (line: string) => console.log(`[release] ${line}`);

  if (attach) {
    children.push(spawnTs("mocks", `${root}/${ENTRIES.mocks}`, env));
    if (!(await waitForReady(`${rootUrl}/ready`, 60_000))) throw new Error(`stack at ${rootUrl} not ready`);
    children.push(spawnTs("sim", `${root}/${ENTRIES.sim}`, env));
  } else {
    // A run is judged from the bus and the services' databases, which outlive the processes that wrote them. The
    // stack this branch is about to start is ours to boot, so the directory starts empty and the run is its own.
    // Under --attach the stack already has those files open and whoever booted it owns emptying them; the driver
    // refuses a bus carrying an earlier run instead (autograder-spec §4).
    clearDataDir(env.SUDSNIK_DATA_DIR!);
    stack = await startStack({ single, mocks: true, sim: true, env });
  }
  if (!(await waitForReady(`${env.SUDSNIK_SIM_URL}/clock`, 60_000))) throw new Error("simulator not ready");
  log(`stack ready at ${rootUrl}; scenario ${name} scale ${scale} seed ${seed}`);

  const deployLog = await drive({
    scenario,
    scale,
    seed,
    seedKind: seed === PUBLIC_SEED ? "public" : "team",
    faults: extraFaults,
    env,
    rootUrl,
    simUrl: env.SUDSNIK_SIM_URL!,
    simToken: env.SUDSNIK_SIM_TOKEN,
    dataDir: env.SUDSNIK_DATA_DIR!,
    resultsDir,
    assignment,
    ...(seams.length > 0 ? { seams } : {}),
    stage: stageName,
    ...(points !== undefined ? { points } : {}),
    ...(deadlineFactor !== undefined ? { deadlineFactor } : {}),
    ledgerKey: process.env.SUDSNIK_LEDGER_KEY ?? DEV_LEDGER_KEY,
    fixtures: loadFixtures(),
    log,
    restartStack: async () => {
      if (stack) return stack.restart();
      const answer = await requestRestart(resultsDir, `${rootUrl}/ready`);
      if (answer.pgid) stackPgid = answer.pgid;
    },
    stopStack: async () => {
      if (stack) {
        await stack.stop();
        return { exited: true };
      }
      if (stackPgid === undefined) return { exited: false };
      return drainGroup(stackPgid);
    },
  });
  await stopAll(children);
  console.log(readFileSync(resolve(resultsDir, "deploy-log.txt"), "utf8"));
  process.exit(deployLog.stages.some((s) => s.status === "failed") ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
