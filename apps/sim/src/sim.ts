import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DRAIN_TAIL_ORBITS,
  FaultEventSchema,
  MINUTE_MS,
  ORBIT_MS,
  SCENARIOS,
  type ClockTick,
  type Envelope,
  type FaultEvent,
  type MockName,
  type OracleJson,
  type Scenario,
  type ScenarioName,
  type SimState,
} from "@sudsnik/contracts";
import type { DeliverRequest } from "@sudsnik/contracts/mocks/relay";
import type { BusConnection } from "@sudsnik/infra-queue";
import { z } from "zod";
import { createTicker, type Ticker } from "./clock.js";
import { hiddenStormDraw } from "./faults/hiddenDraw.js";
import { activeFaults, loadFaultSchedule } from "./faults/schedule.js";
import { judge, type Alert, type ReadySample, type TriageFixture } from "./judge.js";
import { scenarios } from "./scenarios/index.js";
import { createWorld, type World, type WorldSnapshot } from "./world.js";

export const SIM_SERVICE = "sim";

export const RunRequestSchema = z.object({
  scenario: z.enum(SCENARIOS),
  scale: z.number().positive().default(1),
  seed: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  /** Replaces the scenario's known schedule; the storm's hidden draw and extraFaults are added on top. */
  faultsPath: z.string().min(1).optional(),
  extraFaults: z.array(FaultEventSchema).optional(),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const FinishRequestSchema = z.object({
  alerts: z.array(z.object({ atMs: z.number(), rule: z.string(), service: z.string() })).default([]),
  readyTimeline: z.array(z.object({ atMs: z.number(), ready: z.boolean() })).default([]),
  deadLetters: z.number().int().nonnegative().optional(),
  fixtures: z
    .array(z.object({ note: z.string(), injected: z.boolean(), expected: z.object({ category: z.string(), severity: z.string(), action: z.string() }) }))
    .default([]),
  placed: z.array(z.string()).optional(),
  /** Order ids the driver cancelled and saw accepted with 2xx. */
  cancelled: z.array(z.string()).optional(),
});
export type FinishRequest = z.infer<typeof FinishRequestSchema>;

export type RunPhase = "placing" | "draining" | "done";

export interface RunState {
  scenario: Scenario;
  scale: number;
  seed: string;
  faults: FaultEvent[];
  /** Simulated ms of the run's first tick; the scenario's orbit 0 starts there. */
  startMs: number;
  startOrbit: number;
  events: Envelope[];
  phase: RunPhase;
}

export interface SimDeps {
  bus: Pick<BusConnection, "forService" | "readAll" | "deadLetters">;
  postState: (mock: MockName, state: SimState) => Promise<void>;
  deliver: (req: DeliverRequest) => Promise<boolean>;
  urls: { dispatch: string; tracking: string };
  /** SUDSNIK_SEED; any run without its own seed derives from it, and so does the storm's hidden draw unless `hiddenSeed` is set. */
  seed: string;
  /** What the storm's hidden draw derives from under the grader, which the stack under test is never given. */
  hiddenSeed?: string;
  dataDir: string;
  clockRate: number;
  mocks?: readonly MockName[];
  /** SUDSNIK_FLAGS of the stack under test; an invariant about a flagged service is judged only while it is on. */
  flags?: readonly string[];
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface SimStatus {
  running: boolean;
  clock: ClockTick;
  scenario?: ScenarioName;
  scale?: number;
  phase?: RunPhase;
  /** Scenario-relative orbit; absent when idle. */
  orbit?: number;
  ordersByState: Record<string, number>;
  invariants: OracleJson["invariants"];
  faultsInjected: FaultEvent[];
  world: WorldSnapshot;
  stateFailures: Record<string, number>;
}

export interface Sim {
  readonly ticker: Ticker;
  readonly world: World;
  clock(): ClockTick & { running: boolean };
  /** Starts the scenario at the next tick; 409 semantics (throws) while one is placing or draining. */
  run(request: RunRequest): RunState;
  finish(request: FinishRequest): OracleJson;
  status(): SimStatus;
  currentRun(): RunState | undefined;
  oraclePath(): string;
}

export function scenarioOrbit(run: RunState, tick: ClockTick): number {
  return tick.orbit - run.startOrbit;
}

/** One simulator: the ticker, the world, the bus reader, and the run lifecycle behind the HTTP surface. */
export function createSim(deps: SimDeps): Sim {
  const log = deps.log ?? (() => undefined);
  const publisher = deps.bus.forService(SIM_SERVICE);
  const world = createWorld({ deliver: deps.deliver, urls: deps.urls });
  const oraclePath = join(deps.dataDir, "sim", "oracle.json");
  const minuteLogPath = join(deps.dataDir, "logs", "sim.jsonl");
  let minuteLogReady = false;
  /** Per-minute detail goes to a file; stdout carries only run lifecycle lines. */
  function logMinute(event: string, fields: Record<string, unknown>): void {
    if (!minuteLogReady) {
      mkdirSync(dirname(minuteLogPath), { recursive: true });
      minuteLogReady = true;
    }
    appendFileSync(minuteLogPath, `${JSON.stringify({ service: SIM_SERVICE, event, ...fields })}\n`);
  }
  let lastSeq = 0;
  let run: RunState | undefined;
  let pendingRun: Omit<RunState, "startMs" | "startOrbit" | "events" | "phase"> | undefined;

  function writeOracle(oracle: OracleJson): void {
    mkdirSync(dirname(oraclePath), { recursive: true, mode: 0o700 });
    writeFileSync(oraclePath, JSON.stringify(oracle, null, 2));
  }

  function judgeRun(r: RunState, endMs: number, extra: Partial<FinishRequest> = {}): OracleJson {
    return judge({
      scenario: r.scenario,
      events: r.events,
      faults: r.faults,
      startMs: r.startMs,
      endMs,
      alerts: extra.alerts as Alert[] | undefined,
      readyTimeline: extra.readyTimeline as ReadySample[] | undefined,
      fixtures: extra.fixtures as TriageFixture[] | undefined,
      deadLetters: extra.deadLetters ?? deps.bus.deadLetters().length,
      placed: extra.placed,
      cancelled: extra.cancelled,
      flags: deps.flags,
    });
  }

  function ingest(tick: ClockTick): void {
    const fresh = deps.bus.readAll(undefined, lastSeq);
    if (fresh.length === 0) return;
    lastSeq = fresh[fresh.length - 1]!.seq;
    const events = fresh.filter((e) => e.topic !== "clock.tick").map(({ seq: _seq, publisher: _publisher, ...envelope }) => envelope);
    world.observe(events);
    if (run && run.phase !== "done") run.events.push(...events);
    if (events.length > 0) logMinute("sim.ingest", { nowMs: tick.nowMs, events: events.length, pending: world.snapshot().pendingDeliveries });
  }

  function advanceRun(tick: ClockTick): void {
    if (pendingRun) {
      run = { ...pendingRun, startMs: tick.nowMs, startOrbit: tick.orbit, events: [], phase: "placing" };
      pendingRun = undefined;
      log("sim.run.started", { scenario: run.scenario.name, scale: run.scale, seed: run.seed, startMs: run.startMs, faults: run.faults.length });
    }
    if (!run || run.phase === "done") return;
    const orbit = scenarioOrbit(run, tick);
    if (orbit > 0 && tick.orbitPhase === 0) log("sim.orbit", { orbit, phase: run.phase, ordersByState: world.mirror.countByState() });
    if (run.phase === "placing" && orbit >= run.scenario.orbits) {
      run.phase = "draining";
      log("sim.run.draining", { orbit });
    }
    if (orbit >= run.scenario.orbits + DRAIN_TAIL_ORBITS) {
      run.phase = "done";
      writeOracle(judgeRun(run, tick.nowMs));
      log("sim.run.done", { orbit, oracle: oraclePath });
    }
  }

  const ticker = createTicker({
    publish: (envelope) => publisher.publish(envelope),
    postState: deps.postState,
    mocks: deps.mocks,
    clockRate: deps.clockRate,
    faultsAt(orbit) {
      if (!run || run.phase === "done") return [];
      return activeFaults(run.faults, orbit - run.startOrbit);
    },
    async onStep(tick, dark) {
      advanceRun(tick);
      ingest(tick);
      await world.step(tick.nowMs, dark);
    },
  });

  function currentTick(): ClockTick {
    return ticker.current() ?? { nowMs: 0, orbit: 0, orbitPhase: 0 };
  }

  return {
    ticker,
    world,
    clock: () => ({ ...currentTick(), running: ticker.running() }),
    currentRun: () => run,
    oraclePath: () => oraclePath,
    run(request) {
      if (pendingRun || (run && run.phase !== "done")) throw new Error(`scenario ${(pendingRun ?? run)!.scenario.name} is already running`);
      const scenario = scenarios[request.scenario];
      const seed = request.seed ?? deps.seed;
      const faults: FaultEvent[] = [...(request.faultsPath ? loadFaultSchedule(request.faultsPath) : scenario.faults).events];
      if (scenario.name === "storm") faults.push(...hiddenStormDraw(deps.hiddenSeed ?? seed));
      if (request.extraFaults) faults.push(...request.extraFaults);
      pendingRun = { scenario, scale: request.scale, seed, faults };
      const tick = ticker.current();
      const staged: RunState = { ...pendingRun, startMs: tick ? tick.nowMs + MINUTE_MS : 0, startOrbit: 0, events: [], phase: "placing" };
      staged.startOrbit = Math.floor(staged.startMs / ORBIT_MS);
      // Mode 700: under the grader the simulator runs as root beside a stack that must not read the hidden draw.
      mkdirSync(dirname(oraclePath), { recursive: true, mode: 0o700 });
      writeFileSync(join(dirname(oraclePath), "faults.json"), JSON.stringify({ events: faults }, null, 2));
      return staged;
    },
    finish(request) {
      if (!run) throw new Error("no scenario has run");
      const oracle = judgeRun(run, currentTick().nowMs, request);
      writeOracle(oracle);
      log("sim.finished", { scenario: run.scenario.name, oracle: oraclePath });
      return oracle;
    },
    status() {
      const tick = currentTick();
      const snapshot = world.snapshot();
      const base = { running: ticker.running(), clock: tick, ordersByState: snapshot.ordersByState, world: snapshot, stateFailures: ticker.stateFailures() };
      if (!run) return { ...base, invariants: {}, faultsInjected: [] };
      const orbit = scenarioOrbit(run, tick);
      return {
        ...base,
        scenario: run.scenario.name,
        scale: run.scale,
        phase: run.phase,
        orbit,
        invariants: judgeRun(run, tick.nowMs).invariants,
        faultsInjected: run.faults.filter((f) => f.atOrbit <= orbit),
      };
    },
  };
}
