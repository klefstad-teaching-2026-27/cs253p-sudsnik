import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClients, createHttpClient } from "@sudsnik/clients";
import {
  DRAIN_TAIL_ORBITS,
  HABITATS,
  OPERATORS,
  CLOCK_RATE,
  ORBIT_MS,
  PLACEMENT_P95_MS,
  PODS_PER_HABITAT,
  TURNAROUND_SLO,
  MINUTE_MS,
  MOCKS,
  SIM_TOKEN_HEADER,
  mockUrlVar,
  operatorOfHabitat,
  parseTenantKeys,
  podId,
  serviceUrlVar,
  type FaultEvent,
  type OracleJson,
  type Scenario,
  type Topic,
} from "@sudsnik/contracts";
import { unitsPer10k } from "@sudsnik/infra-metering";
import { openBus } from "@sudsnik/infra-queue";
import { Rng, SimClock, newId, subSeed } from "@sudsnik/kernel";
import { fetch } from "undici";
import type { FindingCode } from "./codes.js";
import { isMeasured, loadBands, thresholdsFor, type BandThresholds } from "./bands.js";
import { renderText, sign, summaryLine, type DeployLog, type Finding, type Stage } from "./log.js";
import { errorExcerpts, lostOnDrain, p95, placementDurations, readAlerts, readBreakerOpens, readQuotaRefusals } from "./metrics.js";

/**
 * Wall-clock milliseconds before one call is abandoned. The driver's clock advances only between its own calls,
 * so a simulated timeout can never end one (`docs/system-spec.md` §10.2); this is what keeps a stack that
 * stopped answering from hanging the run.
 */
export const CALL_DEADLINE_MS = 30_000;
/** The run is abandoned at this multiple of the wall time its orbits should take, with a floor for a short scenario. */
export const RUN_DEADLINE_FACTOR = 4;
export const RUN_DEADLINE_FLOOR_MS = 10 * 60_000;
/** Wall-clock milliseconds a mid-run restart may take before the run reports RESTART_FAILED and goes on without it. */
export const RESTART_DEADLINE_MS = 120_000;

function simHeaders(opts: Pick<DriveOptions, "simToken">): Record<string, string> {
  return opts.simToken ? { [SIM_TOKEN_HEADER]: opts.simToken } : {};
}

/** `fetch` that gives up rather than waiting forever, for the simulator and the service endpoints the driver reads. */
function bounded(url: string, init: Parameters<typeof fetch>[1] = {}): ReturnType<typeof fetch> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(CALL_DEADLINE_MS) });
}

export interface DriveOptions {
  scenario: Scenario;
  scale: number;
  seed: string;
  seedKind: "public" | "team";
  faults: FaultEvent[];
  env: Record<string, string>;
  /** Root of the running stack (the --single root or the gateway in multi-process). */
  rootUrl: string;
  simUrl: string;
  /** Sent on every simulator control call and mock `/_sim/*` read; absent locally when nothing requires it. */
  simToken?: string;
  /** What the stage's rows sum to; the grader names its group's points, a local run takes the stage's. */
  points?: number;
  /** Multiplier on the wall time the scenario's orbits should take before the run is abandoned (RUN_DEADLINE_FACTOR). */
  deadlineFactor?: number;
  dataDir: string;
  resultsDir: string;
  assignment: string;
  stage: "canary" | "production";
  ledgerKey: string;
  /**
   * Stops the stack and starts it again on the same data directory, resolving once /ready is 200 again; absent where
   * nothing can, in which case a scenario that asks for one reports RESTART_FAILED.
   */
  restartStack?: () => Promise<void>;
  /** Sends SIGTERM to the stack and resolves when it has exited (or the deadline passed). */
  stopStack: () => Promise<{ exited: boolean }>;
  /** The services the submission replaces; their combined cost is what the units band grades. */
  seams?: string[];
  /** Fixtures for eval scoring; the hostile-notes scenario draws notes from them. */
  fixtures?: { note: string; injected: boolean; expected: { category: string; severity: string; action: string } }[];
  log?: (line: string) => void;
}

interface SimClockView {
  nowMs: number;
  orbit: number;
  orbitPhase: number;
  running: boolean;
}

/**
 * The topics the driver reads a run's progress from. They are also what marks a bus as carrying an earlier run:
 * every one of them exists only because a driver placed an order, where ticks, positions, and the operators
 * `accounts` seeds are all published by a stack that has merely booted.
 */
const DRIVEN_TOPICS: readonly Topic[] = ["order.placed", "order.returned", "order.cancelled"];

/**
 * How many of an earlier run's order events the bus already holds. A bus that does not exist yet holds none, and the
 * file is not opened to find that out: the stack creates it so that it and its WAL belong to the sandbox user
 * (`autograder-spec.md` §4).
 */
export function busBacklog(path: string, clock: SimClock, meter: { charge: () => undefined }): number {
  if (!existsSync(path)) return 0;
  try {
    return openBus({ path, clock, meter }).readAll().filter((m) => DRIVEN_TOPICS.includes(m.topic)).length;
  } catch {
    return 0;
  }
}

/**
 * Copies the run's artifacts into the results directory, returning the ones that arrived. A copy that fails is not
 * worth the deploy log the run exists to produce, so it costs the run nothing but the artifact.
 */
function collect(dataDir: string, resultsDir: string, relative: string[]): string[] {
  // These two directories are the driver's own. Clearing them keeps a previous run's trace from sitting beside this
  // run's deploy log, which names only what this run produced.
  for (const own of ["otel", "logs"]) {
    try {
      rmSync(join(resultsDir, own), { recursive: true, force: true });
    } catch {
      continue;
    }
  }
  const copied: string[] = [];
  for (const rel of relative) {
    const from = join(dataDir, rel);
    if (!existsSync(from)) continue;
    try {
      const to = join(resultsDir, rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied.push(rel);
    } catch {
      continue;
    }
  }
  return copied;
}

/** Runs one scenario against a running stack and writes deploy-log.json and deploy-log.txt. */
export async function drive(opts: DriveOptions): Promise<DeployLog> {
  const started = new Date().toISOString();
  const t0 = Date.now();
  const log = opts.log ?? (() => undefined);
  const findings: Finding[] = [];
  const finding = (severity: Finding["severity"], code: FindingCode, message: string, at?: string) => findings.push({ severity, code, message, ...(at ? { at } : {}) });
  mkdirSync(opts.resultsDir, { recursive: true });

  // Nothing charged here reaches a service's `/cost`, so the driver's own traffic cannot move the units band.
  const clock = new SimClock();
  const meter = { charge: () => undefined };
  const timeoutMs = { internal: 30_000, external: 30_000 };
  const clients = createClients({ service: "driver", env: opts.env, meter, clock, driver: true, timeoutMs, wallTimeoutMs: CALL_DEADLINE_MS });
  const http = createHttpClient({ service: "driver", meter, clock, timeoutMs, wallTimeoutMs: CALL_DEADLINE_MS, driver: true });
  const keys = parseTenantKeys(opts.env.SUDSNIK_TENANT_KEYS ?? "");
  const rng = new Rng(subSeed(opts.seed, "driver"));

  const tokens = new Map<string, string>();
  for (const op of OPERATORS) {
    const r = await clients.identity.token(op, keys[op] ?? "");
    if (!r.ok) finding("error", "TOKEN_FAILED", `${op}: ${r.error.message}`, "identity");
    else tokens.set(op, r.value.token);
  }

  const simClock = async (): Promise<SimClockView | undefined> => {
    try {
      const r = await bounded(`${opts.simUrl}/clock`);
      return (await r.json()) as SimClockView;
    } catch {
      return undefined;
    }
  };
  // The run is judged from the bus and from the services' own state, both of which persist in the data directory.
  // A directory carrying an earlier run's messages would credit its returned orders to this one and leave its pods
  // in open orders, so a dirty environment is refused rather than scored.
  const dirty = busBacklog(opts.env.SUDSNIK_BUS_URL!, clock, meter);
  if (dirty > 0) finding("error", "DIRTY_ENVIRONMENT", `the bus already held ${dirty} order events from an earlier run; SUDSNIK_DATA_DIR must be empty at boot`, "sim");

  const runRes = await bounded(`${opts.simUrl}/run`, { method: "POST", headers: { "content-type": "application/json", ...simHeaders(opts) }, body: JSON.stringify({ scenario: opts.scenario.name, scale: opts.scale, seed: opts.seed, extraFaults: opts.faults }) });
  if (!runRes.ok) finding("error", "SIM_FAILED", `POST /run -> ${runRes.status}`, "sim");

  const gateway = opts.env[serviceUrlVar("gateway")]!.replace(/\/$/, "");
  const placed: string[] = [];
  /** Which API version placed each order; the migration scenario reads each order back on its own version. */
  const versionOf = new Map<string, "v1" | "v2">();
  const tenantOf = new Map<string, string>();
  let v1Responses = 0;
  let v1Deprecated = 0;
  const podCursor = new Map<string, number>();
  const openPods = new Set<string>();
  let habitatIndex = 0;
  const rate = (orbit: number) => (opts.scenario.scaleFromOrbit !== undefined && orbit < opts.scenario.scaleFromOrbit ? opts.scenario.ordersPerOrbit(1) : opts.scenario.ordersPerOrbit(opts.scale));

  async function placeOne(nowMs: number, version: "v1" | "v2", attempt = 1): Promise<void> {
    const habitatId = HABITATS[habitatIndex % HABITATS.length]!;
    habitatIndex++;
    let pod: string | undefined;
    for (let i = 0; i < PODS_PER_HABITAT; i++) {
      const c = (podCursor.get(habitatId) ?? 0) % PODS_PER_HABITAT;
      podCursor.set(habitatId, c + 1);
      const candidate = podId(habitatId, c);
      if (!openPods.has(candidate)) {
        pod = candidate;
        break;
      }
    }
    if (!pod) return;
    const op = operatorOfHabitat(habitatId);
    const token = tokens.get(op);
    if (!token) return;
    const r = await http.call<{ orderId?: string }>({
      method: "POST",
      url: `${gateway}/${version}/orders`,
      kind: "internal",
      ctx: { tenantId: op, correlationId: newId(), idempotencyKey: newId() },
      headers: { authorization: `Bearer ${token}` },
      body: { habitatId, podId: pod },
    });
    if (!r.ok || !r.value.value?.orderId) {
      if (!r.ok && r.error.retryable) {
        if (attempt < PLACE_ATTEMPTS) {
          await sleep(50 * attempt);
          return placeOne(nowMs, version, attempt + 1);
        }
        placementsLostToFaults++;
        return;
      }
      finding("error", "PLACE_FAILED", r.ok ? "no orderId in response" : r.error.message, "gateway");
      return;
    }
    const orderId = r.value.value.orderId;
    placed.push(orderId);
    versionOf.set(orderId, version);
    tenantOf.set(orderId, op);
    if (version === "v1") {
      v1Responses++;
      if (String(r.value.headers.deprecation ?? "").toLowerCase() === "true") v1Deprecated++;
    }
    openPods.add(pod);
    // A cancel lands minutes after placement or an orbit and a half later, by when a pickup is usually scheduled.
    if (opts.scenario.cancels && rng.chance(opts.scenario.cancels.rate)) {
      cancelsDue.push({ orderId, atMs: nowMs + (rng.chance(0.5) ? 5 * MINUTE_MS : 1.5 * ORBIT_MS) });
    }
  }

  /** Every order the driver asked to cancel and saw accepted; the judge holds the stack to each. */
  const cancelled: string[] = [];
  const cancelsDue: { orderId: string; atMs: number }[] = [];
  async function cancelDue(nowMs: number): Promise<void> {
    for (let i = 0; i < cancelsDue.length; ) {
      const c = cancelsDue[i]!;
      if (c.atMs > nowMs) {
        i++;
        continue;
      }
      cancelsDue.splice(i, 1);
      if (returned.has(c.orderId) || collected.has(c.orderId)) continue;
      const op = tenantOf.get(c.orderId);
      const token = op ? tokens.get(op) : undefined;
      if (!op || !token) continue;
      // Only an order not yet collected, a narrower rule than the contract's cancellable states: a cancel after
      // collection would be the refund and the hold-release the contract suite already exercises.
      const current = await http.call<{ state?: string }>({ method: "GET", url: `${gateway}/v1/orders/${c.orderId}`, kind: "internal", ctx: { tenantId: op, correlationId: newId() }, headers: { authorization: `Bearer ${token}` } });
      if (!current.ok) finding("warn", "CANCEL_FAILED", `${c.orderId}: could not read the order before cancelling: ${current.error.message}`, "gateway");
      if (!current.ok || !["placed", "scheduled"].includes(current.value.value?.state ?? "")) continue;
      const r = await http.call({
        method: "POST",
        url: `${gateway}/v1/orders/${c.orderId}/cancel`,
        kind: "internal",
        ctx: { tenantId: op, correlationId: newId(), idempotencyKey: newId() },
        headers: { authorization: `Bearer ${token}` },
        body: { reason: "crew changed their mind" },
      });
      if (r.ok) cancelled.push(c.orderId);
      else finding("warn", "CANCEL_FAILED", `${c.orderId}: ${r.error.message}`, "gateway");
    }
  }

  const totalOrbits = opts.scenario.orbits + DRAIN_TAIL_ORBITS;
  // A known fault (identity 503, payments timeout) is not a submission defect; the driver retries a retryable placement.
  const PLACE_ATTEMPTS = 3;
  /** Orders read back per client set; enough to catch an adapter that renders the wrong currency. */
  const LEDGER_SAMPLE = 25;
  // A scenario that injects an outage is meant to cost throughput. Placements it refuses are reported as one
  // counted warning, not as a defect per occurrence in the submission.
  let placementsLostToFaults = 0;
  /** Every order the scenario's rate called for, whether or not the stack accepted it. */
  let placementsIntended = 0;
  const reported = new Set<string>();
  // `false_green_absent` asks whether the stack ever reported ready while an order was stuck, orbit by orbit,
  // so /ready is sampled once an orbit rather than once at the end (system-spec §10.2).
  const readyTimeline: { atMs: number; ready: boolean }[] = [];
  const probeReady = () => bounded(`${opts.rootUrl}/ready`).then((r) => r.status === 200).catch(() => false);
  let lastNowMs = 0;
  let lastOrbit = -1;
  let restartDownMs: number | undefined;
  let restartTried = false;
  let dueThisOrbit: number[] = [];
  const busPath = opts.env.SUDSNIK_BUS_URL!;
  let bus: ReturnType<typeof openBus> | undefined;
  let lastSeq = 0;
  const returned = new Map<string, number>();
  const collected = new Set<string>();
  const orderPod = new Map<string, string>();

  // The rate the run drove the clock at: the run deadline scales with it, and the deploy log records it, since a
  // run at anything but the canon rate is not comparable with one that was (autograder-spec.md §8.1).
  // A run that cannot finish must still produce a deploy log, so the loop gives up rather than waiting forever.
  const clockRate = Number(opts.env.SUDSNIK_CLOCK_RATE) || CLOCK_RATE;
  const runDeadline = t0 + Math.max(RUN_DEADLINE_FLOOR_MS, ((opts.deadlineFactor ?? RUN_DEADLINE_FACTOR) * totalOrbits * ORBIT_MS) / clockRate);
  for (;;) {
    if (Date.now() > runDeadline) {
      finding("error", "RUN_DEADLINE", `the run passed its deadline of ${Math.round((runDeadline - t0) / 1000)} s with ${placed.length} orders placed; judging what it reached`, "sim");
      break;
    }
    const c = await simClock();
    if (!c) {
      await sleep(100);
      continue;
    }
    lastNowMs = c.nowMs;
    if (c.orbit >= totalOrbits) break;
    if (c.orbit !== lastOrbit) {
      lastOrbit = c.orbit;
      let restartedThisOrbit = false;
      if (opts.scenario.restartAtOrbit !== undefined && c.orbit >= opts.scenario.restartAtOrbit && !restartTried) {
        restartTried = true;
        restartedThisOrbit = true;
        // The outage is part of the run: the clock keeps ticking while the stack is down, and what it kept only in
        // memory is what it has to do without afterwards.
        log(`orbit ${c.orbit}: restarting the stack`);
        const downFrom = Date.now();
        try {
          if (!opts.restartStack) throw new Error("no way to restart the stack was provided");
          let timer: NodeJS.Timeout | undefined;
          const expiry = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`the stack was not back within ${RESTART_DEADLINE_MS / 1000} s`)), RESTART_DEADLINE_MS);
          });
          await Promise.race([opts.restartStack(), expiry]).finally(() => clearTimeout(timer));
          restartDownMs = Date.now() - downFrom;
          log(`stack back after ${restartDownMs} ms`);
        } catch (e) {
          finding("error", "RESTART_FAILED", e instanceof Error ? e.message : String(e), "stack");
        }
      }
      // The clock kept ticking through a restart; the sample is stamped with where it stands now.
      readyTimeline.push({ atMs: restartedThisOrbit ? ((await simClock())?.nowMs ?? c.nowMs) : c.nowMs, ready: await probeReady() });
      const n = c.orbit < opts.scenario.orbits ? rate(c.orbit) : 0;
      dueThisOrbit = Array.from({ length: n }, (_, i) => c.orbit * ORBIT_MS + Math.floor(((i + 0.5) * ORBIT_MS) / Math.max(n, 1)));
      log(`orbit ${c.orbit}: placing ${n} orders; placed so far ${placed.length}, returned ${returned.size}`);
    }
    while (dueThisOrbit.length && dueThisOrbit[0]! <= c.nowMs) {
      dueThisOrbit.shift();
      placementsIntended++;
      const version = opts.scenario.v2Share !== undefined && rng.chance(opts.scenario.v2Share) ? "v2" : "v1";
      await placeOne(c.nowMs, version);
    }
    await cancelDue(c.nowMs);
    if (!bus) {
      try {
        bus = openBus({ path: busPath, clock, meter });
      } catch {
        bus = undefined;
      }
    }
    if (bus) {
      for (const m of bus.readAll(undefined, lastSeq)) {
        lastSeq = m.seq;
        const p = m.payload as { orderId?: string; podId?: string; returnedAt?: number };
        if (m.topic === "order.placed" && p.orderId && p.podId) orderPod.set(p.orderId, p.podId);
        if (m.topic === "pod.collected" && p.orderId) collected.add(p.orderId);
        if ((m.topic === "order.returned" || m.topic === "order.cancelled") && p.orderId) {
          returned.set(p.orderId, m.occurredAt);
          const pod = orderPod.get(p.orderId);
          if (pod) openPods.delete(pod);
          if (m.topic === "order.returned" && opts.scenario.reports && opts.fixtures?.length && !reported.has(p.orderId) && rng.chance(opts.scenario.reports.rate)) {
            reported.add(p.orderId);
            const hostile = rng.chance(opts.scenario.reports.hostileShare);
            const pool = opts.fixtures.filter((f) => f.injected === hostile);
            const fx = rng.pick(pool.length ? pool : opts.fixtures);
            const op = m.tenantId;
            const r = await http.call({
              method: "POST",
              url: `${gateway}/v1/support/reports`,
              kind: "internal",
              ctx: { tenantId: op, correlationId: newId(), idempotencyKey: newId() },
              headers: { authorization: `Bearer ${tokens.get(op) ?? ""}` },
              body: { orderId: p.orderId, podId: pod ?? "unknown", note: fx.note },
            });
            if (!r.ok) finding("warn", "REPORT_FAILED", r.error.message, "gateway");
          }
        }
      }
    }
    await sleep(20);
  }

  if (placementsLostToFaults > 0) {
    finding("warn", "PLACE_FAILED", `${placementsLostToFaults} placements refused by an injected fault after ${PLACE_ATTEMPTS} attempts`, "gateway");
  }
  // Judged while the stack is still up, since both reads go through it; merged into the results below.
  const migrationInvariants: Record<string, { pass: boolean; detail: string }> = {};
  // The migration scenario has two client sets. Each must finish and must read its own orders back on its own
  // version, which is the only thing that exercises the adapter in both directions.
  if (opts.scenario.v2Share !== undefined) {
    const terminal = (id: string) => returned.has(id);
    const sets: Record<"v1" | "v2", string[]> = { v1: [], v2: [] };
    for (const [id, v] of versionOf) sets[v].push(id);
    const currencyOf = new Map<string, string>();
    for (const op of OPERATORS) {
      const r = await http.call<{ currency?: string }>({
        method: "GET",
        url: `${gateway}/v1/accounts/operators/${op}`,
        kind: "internal",
        ctx: { tenantId: op, correlationId: newId() },
        headers: { authorization: `Bearer ${tokens.get(op) ?? ""}` },
      });
      if (r.ok && r.value.value?.currency) currencyOf.set(op, r.value.value.currency);
    }
    const problems: string[] = [];
    const completion: Record<"v1" | "v2", number> = { v1: 1, v2: 1 };
    for (const version of ["v1", "v2"] as const) {
      const ids = sets[version];
      const done = ids.filter(terminal).length;
      // Neither client set may be left behind. Orders still in flight at the end are the tail of any run, so the
      // bar is the turnaround SLO, and the two sets must not diverge: a broken adapter shows as one set lagging.
      completion[version] = ids.length === 0 ? 0 : done / ids.length;
      if (completion[version] < TURNAROUND_SLO.fraction) problems.push(`${version}: only ${done} of ${ids.length} reached a terminal state`);
      for (const id of ids.filter(terminal).slice(0, LEDGER_SAMPLE)) {
        const op = tenantOf.get(id) ?? "op1";
        const r = await http.call<{ currency?: string }[]>({
          method: "GET",
          url: `${gateway}/${version}/billing/ledger?orderId=${encodeURIComponent(id)}`,
          kind: "internal",
          ctx: { tenantId: op, correlationId: newId() },
          headers: { authorization: `Bearer ${tokens.get(op) ?? ""}` },
        });
        if (!r.ok) {
          problems.push(`${version}: ledger read for ${id} failed: ${r.error.message}`);
          break;
        }
        const rows = r.value.value ?? [];
        const want = version === "v1" ? "USD" : (currencyOf.get(op) ?? "USD");
        const wrong = rows.find((row) => row.currency !== undefined && row.currency !== want);
        if (wrong) {
          problems.push(`${version}: ledger for ${id} reported ${wrong.currency}, expected ${want}`);
          break;
        }
      }
    }
    if (Math.abs(completion.v1 - completion.v2) > 0.05) {
      problems.push(`the client sets diverged: v1 ${(completion.v1 * 100).toFixed(1)}%, v2 ${(completion.v2 * 100).toFixed(1)}%`);
    }
    migrationInvariants.both_client_sets_complete = {
      pass: problems.length === 0,
      detail: problems.length === 0 ? `v1 ${sets.v1.length} orders at ${(completion.v1 * 100).toFixed(1)}%, v2 ${sets.v2.length} at ${(completion.v2 * 100).toFixed(1)}%, both read back in their own currency` : problems.slice(0, 3).join("; "),
    };
    migrationInvariants.deprecation_header_on_v1 = {
      pass: v1Responses > 0 && v1Deprecated === v1Responses,
      detail: v1Responses === 0 ? "no /v1 placements were made" : `${v1Deprecated} of ${v1Responses} /v1 responses carried Deprecation`,
    };
  }
  const alerts = readAlerts(opts.dataDir);
  const deadLetters = bus ? bus.deadLetters().length : 0;
  readyTimeline.push({ atMs: lastNowMs, ready: await probeReady() });
  const finishRes = await bounded(`${opts.simUrl}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json", ...simHeaders(opts) },
    body: JSON.stringify({ alerts, readyTimeline, deadLetters, fixtures: opts.fixtures ?? [], placed, cancelled }),
  });
  let oracle: OracleJson | undefined;
  if (finishRes.ok) oracle = (await finishRes.json()) as OracleJson;
  else finding("error", "SIM_FAILED", `POST /finish -> ${finishRes.status}`, "sim");

  // Read /cost per service rather than from the root: in multi-process the root is the gateway and knows only its own.
  const costs: { service: string; totalUnits: number; byOperation: Record<string, { count: number; units: number }>; byEndpoint: Record<string, { count: number; units: number }>; sinceMs: number }[] = [];
  {
    const anyToken = tokens.values().next().value ?? "";
    const flags = parseFlags(opts.env.SUDSNIK_FLAGS);
    for (const service of SERVICES) {
      if (service !== "gateway" && !flags.isOn(`${service}.enabled`)) continue;
      const base = opts.env[serviceUrlVar(service)];
      if (!base) continue;
      try {
        const r = await bounded(`${base.replace(/\/$/, "")}/cost`, { headers: { authorization: `Bearer ${anyToken}` } });
        if (!r.ok) {
          finding("warn", "COST_UNAVAILABLE", `${service} /cost -> ${r.status}`, `service:${service}`);
          continue;
        }
        const body = (await r.json()) as unknown;
        for (const c of Array.isArray(body) ? body : [body]) costs.push(c as (typeof costs)[number]);
      } catch (e) {
        finding("warn", "COST_UNAVAILABLE", e instanceof Error ? e.message : String(e), `service:${service}`);
      }
    }
  }
  writeFileSync(join(opts.resultsDir, "cost.json"), JSON.stringify(costs, null, 2));

  const stopped = await opts.stopStack();
  if (!stopped.exited) finding("error", "UNGRACEFUL_EXIT", "the stack had not exited when the driver read its database");
  const lost = lostOnDrain(opts.dataDir, placed);
  if (!lost.readable) finding("warn", "LOST_ON_DRAIN", "orders.sqlite unreadable or without an orders table; every placed order counted as lost", "orders");
  if (lost.lost.length) finding("error", "LOST_ON_DRAIN", `${lost.lost.length} orders lost: ${lost.lost.slice(0, 5).join(", ")}`, "orders");

  const durations = placementDurations(opts.dataDir);
  // Unmeasured is not the same answer as perfect, so a band with nothing behind it is left out of the log
  // rather than reporting the zero a missing file and a flawless run would share.
  const p95Ms = durations.length > 0 ? Math.round(p95(durations)) : undefined;
  const units = placed.length > 0 ? unitsPer10k(costs as never, placed.length) : undefined;
  // The submission replaces one component, so the band grades that component's cost; the system total is
  // diluted by eight services the student did not write and separates golden from naive barely at all.
  const seams = opts.seams ?? [];
  const seamCost = seams.length > 0 ? costs.filter((c) => seams.includes(c.service)) : [];
  // A seam switched off by flag, as Week 2's production leaves billing, spends nothing, and that is measured rather
  // than missing: the absence is graded by the invariants, and a cost of nothing is what it costs.
  const seamFlags = parseFlags(opts.env.SUDSNIK_FLAGS);
  const unknownSeams = seams.filter((seam) => !(SERVICES as readonly string[]).includes(seam));
  for (const seam of unknownSeams) finding("error", "COST_UNAVAILABLE", `${seam} is not a service; --seam names what the submission replaces`, `service:${seam}`);
  const seamsOff = seams.filter((seam) => !unknownSeams.includes(seam) && seam !== "gateway" && !seamFlags.isOn(`${seam}.enabled` as Parameters<typeof seamFlags.isOn>[0]));
  for (const seam of seams) if (!seamsOff.includes(seam) && !costs.some((c) => c.service === seam)) finding("warn", "COST_UNAVAILABLE", `no /cost for seam ${seam}`, `service:${seam}`);
  // Absent is never perfect and never the system total: a seam whose /cost could not be read is unmeasured.
  const seamsRead = seams.filter((seam) => seamsOff.includes(seam) || costs.some((c) => c.service === seam));
  const unitsSeam =
    placed.length === 0 ? undefined
    : seamCost.length > 0 && seamsRead.length === seams.length ? unitsPer10k(seamCost as never, placed.length)
    : seams.length === 0 ? units
    : seamsOff.length === seams.length && unknownSeams.length === 0 ? 0
    : undefined;
  // The judge computes turnaround from the bus over the orders the driver let run; the driver reads it back.
  const turnaround = oracle?.bands.turnaround;
  const sloBreaches: DeployLog["incident"]["sloBreaches"] = [];
  if (p95Ms !== undefined && p95Ms > PLACEMENT_P95_MS) {
    sloBreaches.push({ slo: "placement_p95_ms", observed: p95Ms, target: PLACEMENT_P95_MS });
    finding("warn", "PLACE_SLOW", `p95 ${p95Ms} ms > ${PLACEMENT_P95_MS} ms`);
  }
  if (opts.scenario.bands.includes("turnaround") && turnaround !== undefined && turnaround < TURNAROUND_SLO.fraction) {
    sloBreaches.push({ slo: "turnaround", observed: turnaround, target: TURNAROUND_SLO.fraction });
    finding("warn", "TURNAROUND_MISSED", `${(turnaround * 100).toFixed(1)}% within ${TURNAROUND_SLO.orbits} orbits`);
  }
  const invariants: DeployLog["results"]["invariants"] = { ...(oracle?.invariants ?? {}), ...migrationInvariants };
  invariants.lost_on_drain = { pass: lost.lost.length === 0 && stopped.exited, detail: `${lost.lost.length} lost; exited=${stopped.exited}` };
  const topicUse = bus ? bus.topicUse() : [];
  const undeclared = topicUse.filter((u) => !isDeclared(u.service, u.topic, u.direction));
  invariants.undeclared_topic = { pass: undeclared.length === 0, detail: undeclared.length ? undeclared.map((u) => `${u.service} ${u.direction} ${u.topic}`).join("; ") : "none" };
  if (undeclared.length) finding("error", "UNDECLARED_TOPIC", invariants.undeclared_topic.detail);
  if (opts.scenario.invariants.includes("breaker_opens_on_429")) {
    // Conditional on a refusal: a submission whose caching never reaches the quota has nothing to break on.
    const opens = readBreakerOpens(opts.dataDir);
    const refusals = await readQuotaRefusals(MOCKS.map((m) => opts.env[mockUrlVar(m)]).filter((u): u is string => Boolean(u)), opts.simToken);
    invariants.breaker_opens_on_429 = {
      pass: refusals === 0 || opens.length > 0,
      detail:
        refusals === 0
          ? "no provider refused a call for quota; nothing to break on"
          : opens.length > 0
            ? `${refusals} quota refusals; ${opens.map((o) => `${o.service}:${o.breaker} at ${o.atMs}`).slice(0, 3).join("; ")}`
            : `${refusals} quota refusals and no breaker opened`,
    };
  }
  invariants.tenant_leak = { pass: true, detail: tenantLeaks(bus ? bus.readAll() : []) };
  if (!invariants.tenant_leak.detail.startsWith("none")) {
    invariants.tenant_leak.pass = false;
    finding("error", "TENANT_LEAK", invariants.tenant_leak.detail);
  }
  for (const [k, v] of Object.entries(invariants)) if (!v.pass && k !== "lost_on_drain" && k !== "undeclared_topic" && k !== "tenant_leak") finding("error", "INVARIANT_FAILED", `${k}: ${v.detail}`);
  // The oracle reports stuck orders as records rather than only in the invariant's prose, so the incident carries
  // the order ids a postmortem needs and the count cannot drift from the sentence that describes it.
  const stuckOrders = oracle?.stuckOrders ?? [];
  const stuckCount = stuckOrders.length;
  if (stuckCount) finding("warn", "STUCK_ORDERS", oracle?.invariants.no_stuck_orders?.detail ?? `${stuckCount} stuck at end`);
  if (deadLetters) finding("warn", "DEAD_LETTERS", `${deadLetters} dead letters`);
  const bands: Record<string, number> = { ...(oracle?.bands ?? {}), dead_letters: deadLetters };
  if (p95Ms !== undefined) bands.p95 = p95Ms;
  if (unitsSeam !== undefined) bands.units = unitsSeam;
  if (units !== undefined) bands.units_system = units;
  // Per-service figures let one golden run calibrate every seam that shares its scenario and scale.
  const unitsByService: Record<string, number> = {};
  for (const c of costs) unitsByService[c.service] = unitsPer10k([c] as never, placed.length);

  // A run the stack accepted no order into demonstrated nothing: every invariant would pass over an empty
  // set and every band would be unmeasured, so there is nothing to award.
  if (placed.length === 0) finding("error", "PLACE_FAILED", `no order was accepted; the scenario called for ${placementsIntended}`, "gateway");
  else if (placed.length * 2 < placementsIntended) finding("error", "PLACE_FAILED", `only ${placed.length} of ${placementsIntended} placements were accepted`, "gateway");
  // Per assignment and stage: the canary's run is not the week's production run, so the two are not judged by one
  // row of measurements (`bands.ts`). A stage with no row of its own still reads the assignment's.
  const thresholds = thresholdsFor(loadBands(), opts.assignment, opts.stage);
  const outOf = opts.points ?? STAGE_POINTS[opts.stage];
  const items = scoreItems(opts.stage, opts.scenario, invariants, bands, thresholds, outOf);
  // A run the stack accepted no order into demonstrated nothing, so no row of it passes.
  if (placed.length === 0) for (const i of items) i.passed = false;
  const score = sumItems(items);
  // The deploy log names artifacts relative to the results directory (`autograder-spec.md` §8.1), and it is the
  // results directory that is kept: under the grader the data directory is scratch and goes with the run. The trace
  // and the logs a finding cites are copied there rather than named where nothing will look for them.
  // The injected schedule travels with the run; under the grader the runner takes it back out until the due date.
  const artifacts = ["cost.json", ...collect(opts.dataDir, opts.resultsDir, ["otel/trace.jsonl", "sim/faults.json", ...Object.keys(errorExcerpts(opts.dataDir)).map((f) => `logs/${f}`)])];
  const stage: Stage = {
    stage: opts.stage,
    status: findings.some((f) => f.severity === "error") ? "failed" : "passed",
    durationMs: Date.now() - t0,
    findings,
    artifacts,
    ...(restartDownMs !== undefined ? { restartDownMs } : {}),
  };
  // -1 reads as "not measured" in the summary line, which is the one line telemetry keeps (autograder-spec §8.2).
  const summary = summaryLine({ stage: opts.stage, scenario: opts.scenario.name, unitsPer10k: unitsSeam ?? -1, p95Ms: p95Ms ?? -1, turnaround: turnaround ?? -1, lost: lost.lost.length, stuck: stuckCount, score, outOf });
  const contractsVersion = readContractsVersion();
  const partial = {
    run: { assignment: opts.assignment, seed: opts.seedKind, scenario: opts.scenario.name, scale: opts.scale, clockRate, startedAt: started, contractsVersion },
    incident: { alerts, sloBreaches, stuckOrders, deadLetters, lostOnDrain: lost.lost.length },
    score: { public: 0, contract: 0, canary: opts.stage === "canary" ? score : 0, production: opts.stage === "production" ? score : 0, total: score },
  };
  const deployLog: DeployLog = { ...partial, stages: [stage], results: { invariants, bands, unitsByService, items }, summary, signature: sign(partial, opts.ledgerKey) };
  writeFileSync(join(opts.resultsDir, "deploy-log.json"), JSON.stringify(deployLog, null, 2));
  writeFileSync(join(opts.resultsDir, "deploy-log.txt"), renderText(deployLog));
  if (bus) bus.close();
  await http.close();
  await clients.http.close();
  return deployLog;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import { declaredTopics, isTopic, parseFlags, type Service, SERVICES } from "@sudsnik/contracts";
function isDeclared(service: string, topic: string, direction: string): boolean {
  if (service === "sim" || service === "driver") return true;
  if (!(SERVICES as readonly string[]).includes(service) || !isTopic(topic)) return false;
  const d = declaredTopics[service as Service];
  return direction === "publish" ? d.publishes.includes(topic) : topic === "clock.tick" || d.consumes.includes(topic);
}

/** An envelope whose payload names an operator other than its tenant is a leak. */
function tenantLeaks(messages: { tenantId: string; payload: unknown; topic: string; id: string }[]): string {
  const leaks: string[] = [];
  for (const m of messages) {
    if (m.tenantId === "system") continue;
    const text = JSON.stringify(m.payload);
    for (const op of OPERATORS) if (op !== m.tenantId && new RegExp(`"${op}"`).test(text)) leaks.push(`${m.topic} ${m.id} tenant ${m.tenantId} carries ${op}`);
  }
  return leaks.length ? leaks.slice(0, 5).join("; ") : "none";
}

function readContractsVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../../packages/contracts/package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

/** The three bands every run reports; anything else a scenario declares is that scenario's own (§7.1). */
const SLO_BANDS: readonly string[] = ["turnaround", "p95", "units"];

/** Stage points (autograder-spec §7.1): what the items of a stage sum to unless the caller names another total. */
export const STAGE_POINTS = { canary: 30, production: 50 } as const;

/** Dead letters have a natural scale: none is full credit, and a handful is half (autograder-spec §7.2). */
export const DEAD_LETTERS_BAND = { full: 0, half: 5 } as const;
/** Time to detect, in simulated minutes: within the orbit the fault landed in is full credit, within the three orbits that make an order stuck is half. */
export const TIME_TO_DETECT_BAND = { full: 90, half: 270 } as const;

/** Bands whose credit needs the seam to have done its work: cheapness while an invariant fails is absence, not efficiency. */
const COST_BANDS: readonly string[] = ["units", "tokens_per_10k"];

/** One graded row of a stage: what the grader turns into a weighted test, and what the local log lists. */
export interface ScoreItem {
  id: string;
  weight: number;
  passed: boolean;
  detail: string;
}

/**
 * The rows of a stage, with weights from autograder-spec §7.1 scaled to `points`. Invariants are one row each. A band
 * is two rows of equal weight, `<band>.half` and `<band>.full`, so half credit is one passed row. Bands score
 * against fixtures/bands.yaml once calibrated; where the file holds no row for the stage, a measured band scores half
 * rather than a threshold nobody measured; where the row is there and empty, the stage was calibrated and separated
 * nothing, and its bands keep their weight as one passed row each the way `turnaround` does in a scenario that does
 * not measure it. A band the run could not measure scores nothing (absent is never perfect). The sum of the rows is
 * the stage score, and nothing else re-derives it.
 */
export function scoreItems(
  stage: "canary" | "production",
  scenario: Scenario,
  invariants: Record<string, { pass: boolean; detail?: string }>,
  bands: Record<string, number>,
  thresholds: Record<string, BandThresholds> | undefined = undefined,
  points: number = STAGE_POINTS[stage],
): ScoreItem[] {
  const base = stage === "canary" ? { lost: 10, tenant: 4, topic: 4, scenario: 6, turnaround: 2, p95: 2, units: 2 } : { lost: 10, tenant: 5, topic: 5, scenario: 15, turnaround: 5, p95: 5, units: 5 };
  const scale = points / STAGE_POINTS[stage];
  const w = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * scale])) as typeof base;
  const items: ScoreItem[] = [];
  const invariant = (id: string, weight: number) => items.push({ id, weight, passed: invariants[id]?.pass === true, detail: invariants[id]?.detail ?? "not judged" });
  invariant("lost_on_drain", w.lost);
  invariant("tenant_leak", w.tenant);
  invariant("undeclared_topic", w.topic);
  const own = scenario.invariants.filter((i) => !["lost_on_drain", "tenant_leak", "undeclared_topic"].includes(i));
  for (const id of own) invariant(id, w.scenario / own.length);
  const workDone = own.every((id) => invariants[id]?.pass === true);

  const band = (id: string, weight: number, judge: (v: number) => { half: boolean; full: boolean; detail: string }) => {
    const value = bands[id];
    const half = weight / 2;
    if (COST_BANDS.includes(id) && !workDone) {
      const detail = "no cost credit while a scenario invariant fails";
      items.push({ id: `${id}.half`, weight: half, passed: false, detail }, { id: `${id}.full`, weight: half, passed: false, detail });
      return;
    }
    if (!isMeasured(value)) {
      items.push({ id: `${id}.half`, weight: half, passed: false, detail: "not measured" }, { id: `${id}.full`, weight: half, passed: false, detail: "not measured" });
      return;
    }
    const j = judge(value);
    items.push({ id: `${id}.half`, weight: half, passed: j.half, detail: j.detail }, { id: `${id}.full`, weight: half, passed: j.full, detail: j.detail });
  };
  // A stage row that is there and empty is a stage calibration ran on and wrote nothing for: the two ends were
  // measured and could not be separated (autograder-spec.md §7.2). No row at all is a stage nobody calibrated,
  // which is what a local run has, and an uncalibrated band scores half. The two must not be read as one thing.
  const separatedNothing = thresholds !== undefined && Object.keys(thresholds).length === 0;
  const calibrated = (id: string, weight: number) => {
    const t = thresholds?.[id];
    // Nothing a submission does moves a band whose ends are indistinguishable, so the band keeps its weight as one
    // passed row rather than costing every student, the perfect one included, half of it — exactly as `turnaround`
    // does in a scenario that does not measure it.
    if (t === undefined && separatedNothing) {
      items.push({ id, weight, passed: true, detail: "measured, and the two ends could not be separated; weight kept" });
      return;
    }
    band(id, weight, (v) => {
      if (!t) return { half: true, full: false, detail: `${v}; uncalibrated, so half credit` };
      const meets = (threshold: number) => (t.lowerIsBetter ? v <= threshold : v >= threshold);
      return { half: meets(t.half), full: meets(t.full), detail: `${v} against full ${t.full}, half ${t.half}` };
    });
  };
  const natural = (id: string, weight: number, full: number, half: number, lowerIsBetter: boolean) =>
    band(id, weight, (v) => {
      const meets = (threshold: number) => (lowerIsBetter ? v <= threshold : v >= threshold);
      return { half: meets(half), full: meets(full), detail: `${v} against full ${full}, half ${half}` };
    });

  if (scenario.bands.includes("turnaround")) natural("turnaround", w.turnaround, TURNAROUND_SLO.fraction, TURNAROUND_SLO.fraction / 2, false);
  else {
    // A scenario that does not measure turnaround measures something else instead, and what it measures is
    // what the week is about: the alert that detected the storm, the eval that caught the injected note. Those
    // take the weight turnaround leaves, so the stage totals of §7.1 hold whatever a scenario declares.
    const ownBands = scenario.bands.filter((id) => !SLO_BANDS.includes(id));
    if (ownBands.length === 0) items.push({ id: "turnaround", weight: w.turnaround, passed: true, detail: "not measured by this scenario; weight kept" });
    for (const id of ownBands) {
      if (id === "dead_letters") natural(id, w.turnaround / ownBands.length, DEAD_LETTERS_BAND.full, DEAD_LETTERS_BAND.half, true);
      else if (id === "time_to_detect") natural(id, w.turnaround / ownBands.length, TIME_TO_DETECT_BAND.full, TIME_TO_DETECT_BAND.half, true);
      else calibrated(id, w.turnaround / ownBands.length);
    }
  }
  natural("p95", w.p95, PLACEMENT_P95_MS, 2 * PLACEMENT_P95_MS, true);
  calibrated("units", w.units);
  return items;
}

/** The stage score: the sum of its passed rows, to a tenth of a point. */
export function scoreStage(
  stage: "canary" | "production",
  scenario: Scenario,
  invariants: Record<string, { pass: boolean; detail?: string }>,
  bands: Record<string, number>,
  thresholds: Record<string, BandThresholds> | undefined = undefined,
  points: number = STAGE_POINTS[stage],
): number {
  return sumItems(scoreItems(stage, scenario, invariants, bands, thresholds, points));
}

export function sumItems(items: ScoreItem[]): number {
  return Math.round(items.filter((i) => i.passed).reduce((sum, i) => sum + i.weight, 0) * 10) / 10;
}
