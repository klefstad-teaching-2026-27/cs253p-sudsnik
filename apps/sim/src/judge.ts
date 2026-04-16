import {
  DRAIN_TAIL_ORBITS,
  MINUTE_MS,
  ORBIT_MS,
  TURNAROUND_SLO,
  type BandId,
  type Envelope,
  type FaultEvent,
  type InvariantId,
  type OracleJson,
  type PayloadOf,
  type Scenario,
} from "@sudsnik/contracts";
import { OrderMirror, isTerminal, type HoldRecord, type OrderRecord } from "./orders.js";

export const STUCK_AFTER_MS = 3 * ORBIT_MS;
/** How long after a return the charge may still be on its way before an unpaid order counts as unsettled. */
export const SETTLEMENT_GRACE_MS = 10 * MINUTE_MS;
/** The share of returned orders a capture may still be retrying for at the end, under the known payment timeouts. */
export const SETTLEMENT_TOLERANCE = 0.02;
/** The world steps once a simulated minute: a pod collected within this of the cancellation was collected beside it, not after it. */
export const CANCEL_RACE_MS = 2 * MINUTE_MS;

export interface Alert {
  atMs: number;
  rule: string;
  service: string;
}

export interface ReadySample {
  atMs: number;
  ready: boolean;
}

export interface TriageFixture {
  note: string;
  injected: boolean;
  expected: { category: string; severity: string; action: string };
}

export interface JudgeInput {
  scenario: Scenario;
  /** Every bus event of the run except clock.tick, in stream order. */
  events: readonly Envelope[];
  /** The full schedule injected: known, hidden, and extra. */
  faults: readonly FaultEvent[];
  /** Simulated ms of the run's first tick and of the tick judged at. */
  startMs: number;
  endMs: number;
  alerts?: readonly Alert[];
  readyTimeline?: readonly ReadySample[];
  fixtures?: readonly TriageFixture[];
  deadLetters?: number;
  /** Order ids the driver saw accepted with 2xx. */
  placed?: readonly string[];
  /** Order ids the driver cancelled and saw accepted with 2xx. */
  cancelled?: readonly string[];
  /** SUDSNIK_FLAGS of the stack under test. */
  flags?: readonly string[];
}

/**
 * Relay faults an ingest can see, and where time to detect is measured from. A deferral of one minute reorders
 * nothing at forty orders an orbit, so `reorder-rate` produces no symptom to detect.
 */
export const DETECTABLE_FAULT_KINDS: readonly string[] = ["duplicate-rate", "bitflip-rate"];

type Verdict = { pass: boolean; detail: string };
type Judged = { mirror: OrderMirror; reports: Map<string, { note: string; fixture?: TriageFixture }>; triages: PayloadOf<"triage.completed">[] };

export function normalizeNote(note: string): string {
  return note.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The fixture whose normalized note occurs in the normalized report note, longest first, as the oracle matches. */
export function matchFixture(note: string, fixtures: readonly TriageFixture[]): TriageFixture | undefined {
  const needle = normalizeNote(note);
  let best: TriageFixture | undefined;
  for (const f of fixtures) {
    const n = normalizeNote(f.note);
    if (n.length > 0 && needle.includes(n) && (!best || n.length > normalizeNote(best.note).length)) best = f;
  }
  return best;
}

function replay(input: JudgeInput): Judged {
  const mirror = new OrderMirror();
  const reports = new Map<string, { note: string; fixture?: TriageFixture }>();
  const triages: PayloadOf<"triage.completed">[] = [];
  for (const e of input.events) {
    const seen = mirror.apply(e);
    if (!seen) continue;
    if (seen.topic === "anomaly.reported") {
      const p = seen.envelope.payload as PayloadOf<"anomaly.reported">;
      reports.set(p.reportId, { note: p.note, fixture: input.fixtures ? matchFixture(p.note, input.fixtures) : undefined });
    } else if (seen.topic === "triage.completed") {
      triages.push(seen.envelope.payload as PayloadOf<"triage.completed">);
    }
  }
  return { mirror, reports, triages };
}

function orders(j: Judged): OrderRecord[] {
  return [...j.mirror.orders.values()];
}

function stuckAt(o: OrderRecord, atMs: number): boolean {
  return !isTerminal(o.state) && o.lastChangeAt <= atMs - STUCK_AFTER_MS;
}

function holdEnd(h: HoldRecord, endMs: number): number {
  return Math.min(h.endedAt ?? endMs, h.expiresAt);
}

function noDoubleLaunch(j: Judged, endMs: number): Verdict {
  const byWasher = new Map<string, Array<{ orderId: string; from: number; to: number }>>();
  for (const o of orders(j)) {
    for (const h of o.holds) {
      const list = byWasher.get(h.washerId) ?? [];
      list.push({ orderId: o.orderId, from: h.acquiredAt, to: holdEnd(h, endMs) });
      byWasher.set(h.washerId, list);
    }
  }
  const clashes: string[] = [];
  for (const [washerId, holds] of byWasher) {
    holds.sort((a, b) => a.from - b.from);
    for (let i = 1; i < holds.length; i++) {
      const prev = holds[i - 1]!;
      const cur = holds[i]!;
      if (cur.orderId !== prev.orderId && cur.from < prev.to) clashes.push(`${washerId}: ${prev.orderId} and ${cur.orderId}`);
    }
  }
  return clashes.length === 0
    ? { pass: true, detail: `${byWasher.size} washers held, no overlapping holds` }
    : { pass: false, detail: `${clashes.length} overlapping holds: ${clashes.slice(0, 5).join("; ")}` };
}

/** How long after a hold's expiry the judge waits for the event that ends it; a stack behind the clock catches up within this. */
export const HOLD_END_GRACE_MS = STUCK_AFTER_MS;

/**
 * `docs/system-spec.md` §9.5: a hold ends by an event, `hold.released`, `hold.expired`, or the `wash.started` that
 * consumes it. A hold that passed its expiry long ago with none of them was forgotten, which is what a store kept
 * only in memory does to every hold it had when the process stopped; the washer stays idle to the fleet and held
 * to the order. Judged over the holds whose expiry plus a grace fell inside the run.
 */
function noForgottenHolds(j: Judged, endMs: number): Verdict {
  const forgotten: string[] = [];
  let judged = 0;
  for (const o of orders(j)) {
    for (const h of o.holds) {
      if (h.expiresAt + HOLD_END_GRACE_MS > endMs) continue;
      judged++;
      if (h.status === "active") forgotten.push(`${o.orderId} hold ${h.holdId} on ${h.washerId}`);
    }
  }
  if (judged === 0) return { pass: false, detail: "not judged: no hold reached its expiry within the run" };
  return forgotten.length === 0
    ? { pass: true, detail: `${judged} holds reached their expiry; every one had ended by an event` }
    : { pass: false, detail: `${forgotten.length} of ${judged} holds were never ended by an event: ${forgotten.slice(0, 5).join("; ")}` };
}

/**
 * No cycle starts on a hold the washer had already let lapse. A hold reserves an idle washer for one orbit
 * (`docs/system-spec.md` §2.2) and the v1 firmware lets it go silently, so a store that does not expire its own
 * holds starts a cycle on a washer the firmware has already handed to somebody else.
 */
function noLaunchOnExpiredHold(j: Judged): Verdict {
  const offences: string[] = [];
  let judged = 0;
  for (const o of orders(j)) {
    for (const h of o.holds) {
      if (h.status !== "consumed" || h.endedAt === undefined) continue;
      judged++;
      if (h.endedAt > h.expiresAt) offences.push(`${o.orderId} hold ${h.holdId} started ${h.endedAt - h.expiresAt} ms after it expired`);
    }
  }
  return offences.length === 0
    ? { pass: true, detail: `${judged} cycles started on a live hold` }
    : { pass: false, detail: `${offences.length} cycles started on an expired hold: ${offences.slice(0, 5).join("; ")}` };
}

/** When each node named by a `dark` fault was out of contact, in simulated milliseconds. */
function darkNodeWindows(input: JudgeInput): Array<{ nodeId: string; from: number; to: number }> {
  const out: Array<{ nodeId: string; from: number; to: number }> = [];
  for (const f of input.faults) {
    if (f.kind !== "dark" || f.params.kind !== "node" || typeof f.params.id !== "string") continue;
    const from = input.startMs + f.atOrbit * ORBIT_MS;
    out.push({ nodeId: f.params.id, from, to: f.orbits === undefined ? input.endMs : from + f.orbits * ORBIT_MS });
  }
  return out;
}

/** Each stretch the order spent in `washing`, closed at the end of the run while it is still there. */
function washingSpans(o: OrderRecord, endMs: number): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let from: number | undefined;
  for (const t of o.transitions) {
    if (t.state === "washing") from ??= t.atMs;
    else if (from !== undefined) {
      spans.push({ from, to: t.atMs });
      from = undefined;
    }
  }
  if (from !== undefined) spans.push({ from, to: endMs });
  return spans;
}

/**
 * `docs/system-spec.md` §10.3: while a node is dark its `washer-v2` completion callbacks are held by `relay` and
 * its `washer-v1` status polling times out, so a cycle that finishes in the dark is not reported when it finishes.
 * Every cycle that was running at a darkened node while it was dark has to be reported by the end of the run,
 * which it is only if something goes back for what the callback never delivered: that stretch of `washing` has
 * closed. What happens afterwards is not this cycle's: a retry mid-wash at the end is work in progress, and the
 * pod's trip home is the shuttles', which at scale are the backlog.
 */
function reconciliationCompletes(j: Judged, input: JudgeInput): Verdict {
  const windows = darkNodeWindows(input);
  // A scenario that declares this and darkens no node has asked a question of a run that never posed it, which
  // is the empty set this invariant used to pass over.
  if (windows.length === 0) return { pass: false, detail: "not judged: no node went dark, so no callback was held" };
  const darkSpans = (o: OrderRecord) => {
    const nodes = new Set(o.holds.map((h) => h.nodeId));
    return washingSpans(o, input.endMs).filter((s) => windows.some((w) => nodes.has(w.nodeId) && s.from < w.to && s.to > w.from));
  };
  const affected = orders(j).filter((o) => darkSpans(o).length > 0);
  // A span still open at the end is the one the run closed, not an event.
  const open = affected.filter((o) => darkSpans(o).some((s) => s.to === input.endMs));
  const where = windows.map((w) => w.nodeId).join(", ");
  return open.length === 0
    ? { pass: true, detail: `${affected.length} cycles ran at ${where} while it was dark; every one was reported` }
    : { pass: false, detail: `${open.length} of ${affected.length} cycles that ran at ${where} in the dark were never reported: ${open.slice(0, 5).map((o) => `${o.orderId} still washing`).join(", ")}` };
}

/**
 * system-spec §10.2: dropped means lost, never queued. An order the driver placed that the stream never mentions,
 * one cancelled with origin `system` because a service gave up on it, or one a service marked permanently failed.
 * A permanent failure that is then cancelled is one dropped order, not two. An order still queued or in flight when
 * the run ends is correct back-pressure under an overloaded scenario, and the bands measure what the queueing cost.
 */
function noDroppedOrders(j: Judged, input: JudgeInput): Verdict {
  const all = orders(j);
  const missing = (input.placed ?? []).filter((id) => !j.mirror.orders.has(id));
  const failed = all.filter((o) => o.permanentlyFailed);
  const abandoned = all.filter((o) => o.cancelledBy === "system" && !o.permanentlyFailed);
  const openAtEnd = all.filter((o) => !isTerminal(o.state)).length;
  const problems = [
    ...missing.map((id) => `${id} never reached the bus`),
    ...failed.map((o) => `${o.orderId} permanently failed`),
    ...abandoned.map((o) => `${o.orderId} cancelled by the system`),
  ];
  const context = `${openAtEnd} still queued or in flight at the end${input.placed ? "" : " (driver's placed list not supplied)"}`;
  return problems.length === 0
    ? { pass: true, detail: `no order dropped; ${context}` }
    : { pass: false, detail: `${problems.length} dropped (${missing.length} never on the bus, ${failed.length} permanently failed, ${abandoned.length} cancelled by the system); ${context}: ${problems.slice(0, 5).join("; ")}` };
}

function noStuckOrders(j: Judged, endMs: number): Verdict {
  const stuck = orders(j).filter((o) => stuckAt(o, endMs));
  return stuck.length === 0
    ? { pass: true, detail: "no order without a state change for 3 orbits at end" }
    : { pass: false, detail: `${stuck.length} stuck at end: ${stuck.slice(0, 5).map((o) => `${o.orderId} in ${o.state}`).join(", ")}` };
}

function readyDuring(timeline: readonly ReadySample[], fromMs: number, toMs: number): boolean {
  const within = timeline.filter((s) => s.atMs >= fromMs && s.atMs < toMs);
  if (within.length > 0) return within.some((s) => s.ready);
  const before = timeline.filter((s) => s.atMs < fromMs).sort((a, b) => b.atMs - a.atMs)[0];
  return before?.ready ?? false;
}

function falseGreenAbsent(j: Judged, input: JudgeInput): Verdict {
  if (!input.readyTimeline || input.readyTimeline.length === 0) return { pass: true, detail: "not measured: no /ready timeline supplied" };
  const alerts = input.alerts ?? [];
  const all = orders(j);
  const greens: number[] = [];
  for (let from = input.startMs; from < input.endMs; from += ORBIT_MS) {
    const to = from + ORBIT_MS;
    const stuck = all.some((o) => o.placedAt < to && stuckAt(o, to) && o.lastChangeAt < from);
    if (!stuck) continue;
    const alerted = alerts.some((a) => a.atMs >= from && a.atMs < to);
    if (!alerted && readyDuring(input.readyTimeline, from, to)) greens.push(Math.floor((from - input.startMs) / ORBIT_MS));
  }
  return greens.length === 0
    ? { pass: true, detail: "no orbit reported ready without an alert while an order was stuck" }
    : { pass: false, detail: `false green in orbits ${greens.join(", ")}` };
}

function noCleanOnInjected(j: Judged, input: JudgeInput): Verdict {
  if (!input.fixtures || input.fixtures.length === 0) return { pass: true, detail: "not measured: no fixtures supplied" };
  const offences: string[] = [];
  let injected = 0;
  for (const t of j.triages) {
    const r = j.reports.get(t.reportId);
    if (!r?.fixture?.injected) continue;
    injected++;
    if (t.action === "clean") offences.push(t.reportId);
  }
  return offences.length === 0
    ? { pass: true, detail: `${injected} triages of injected notes, none marked clean` }
    : { pass: false, detail: `${offences.length} injected notes marked clean: ${offences.slice(0, 5).join(", ")}` };
}

/**
 * Every order the driver cancelled must have been cancelled: an `order.cancelled` from the customer, no physical
 * progress after it beyond the world's own tick (a pickup scheduled at any time is not progress; a pod collected
 * later is), a refund after any charge, and no washer hold left active or consumed after it. A cancel that answers
 * 200 and changes nothing fails the first of these.
 */
function cancelledOrdersCompensated(j: Judged, input: JudgeInput): Verdict {
  const asked = input.cancelled ?? [];
  if (asked.length === 0) return { pass: false, detail: "not judged: the driver cancelled no order" };
  const problems: string[] = [];
  let raced = 0;
  for (const id of asked) {
    const o = j.mirror.orders.get(id);
    if (!o) {
      problems.push(`${id} never reached the bus`);
      continue;
    }
    if (o.cancelledBy !== "customer" || o.cancelledAt === undefined) {
      problems.push(`${id} was never cancelled on the bus`);
      continue;
    }
    // A pod collected in the world's tick beside the cancel was collected, whatever orders answered: the shuttle has
    // it, and what the stack does with it afterwards is the return path's and not this invariant's.
    if (o.afterCancel.some((s) => s.state === "collected" && s.atMs <= o.cancelledAt! + CANCEL_RACE_MS)) {
      raced++;
      continue;
    }
    const progress = o.afterCancel.filter((s) => !["placed", "scheduled", "cancelled"].includes(s.state) && s.atMs > o.cancelledAt! + CANCEL_RACE_MS);
    if (progress.length > 0) problems.push(`${id} went on to ${progress[progress.length - 1]!.state} after its cancellation`);
    // Charged before or after: a charge that stands with no refund after it is money the crew never got back.
    const lastCharge = Math.max(-1, ...o.charges.map((c) => c.atMs));
    if (o.charges.length > 0 && !o.refunds.some((r) => r.atMs >= lastCharge)) problems.push(`${id} was charged and never refunded`);
    const live = o.holds.filter((h) => h.status === "active" || (h.endedAt !== undefined && h.endedAt > o.cancelledAt!));
    if (live.some((h) => h.status === "active" || h.status === "consumed")) problems.push(`${id} kept a washer hold after cancelling`);
  }
  return problems.length === 0
    ? { pass: true, detail: `${asked.length} cancellations, each cancelled on the bus with its compensations${raced ? `; ${raced} collected beside the cancel and not judged` : ""}` }
    : { pass: false, detail: `${problems.length} of ${asked.length} cancellations not honoured: ${problems.slice(0, 5).join("; ")}` };
}

/**
 * Every returned order carries exactly one captured charge: none is a billing that never billed, two is a duplicate
 * webhook charged twice. Judged only while `billing.enabled` is on, since a stack degrading without billing owes
 * nobody a charge (system-spec §8, `hollow`).
 */
function ordersSettled(j: Judged, input: JudgeInput): Verdict {
  if (input.flags && !input.flags.includes("billing.enabled")) return { pass: true, detail: "not judged: billing.enabled is off" };
  // An order returned in the run's last minutes has not had time to be charged; the capture follows the return.
  const returned = orders(j).filter((o) => o.state === "returned" && (o.returnedAt ?? o.lastChangeAt) <= input.endMs - SETTLEMENT_GRACE_MS);
  if (returned.length === 0) return { pass: false, detail: "not judged: no order was returned early enough to be charged" };
  const unpaid = returned.filter((o) => o.charges.length === 0);
  const twice = returned.filter((o) => o.charges.length > 1);
  // A capture the payments provider timed out on may still be on its retry at the end; a billing that never
  // bills is not one in fifty. A second charge is never a retry.
  const allowed = Math.ceil(returned.length * SETTLEMENT_TOLERANCE);
  return unpaid.length <= allowed && twice.length === 0
    ? { pass: true, detail: `${returned.length} returned orders, ${returned.length - unpaid.length} captured once, none twice` }
    : { pass: false, detail: `${unpaid.length} returned orders never charged (${allowed} allowed), ${twice.length} charged more than once: ${[...unpaid, ...twice].slice(0, 5).map((o) => `${o.orderId} x${o.charges.length}`).join(", ")}` };
}

/**
 * The driver judges these from outside the event stream and merges its verdicts over the oracle's, so this verdict
 * survives only where nothing judged the invariant at all. That is a failure, not a pass: crediting it would hand a
 * submission an invariant no check ever ran.
 */
const NOT_JUDGED: Verdict = { pass: false, detail: "not judged: outside what the simulator can see, and no driver verdict replaced it" };

function invariant(id: InvariantId, j: Judged, input: JudgeInput): Verdict {
  switch (id) {
    case "no_double_launch":
      return noDoubleLaunch(j, input.endMs);
    case "no_launch_on_expired_hold":
      return noLaunchOnExpiredHold(j);
    case "reconciliation_completes":
      return reconciliationCompletes(j, input);
    case "no_forgotten_holds":
      return noForgottenHolds(j, input.endMs);
    case "no_dropped_orders":
      return noDroppedOrders(j, input);
    case "no_stuck_orders":
      return noStuckOrders(j, input.endMs);
    case "false_green_absent":
      return falseGreenAbsent(j, input);
    case "no_clean_on_injected":
      return noCleanOnInjected(j, input);
    case "cancelled_orders_compensated":
      return cancelledOrdersCompensated(j, input);
    case "orders_settled":
      return ordersSettled(j, input);
    case "breaker_opens_on_429":
    case "both_client_sets_complete":
    case "deprecation_header_on_v1":
    case "lost_on_drain":
    case "tenant_leak":
    case "undeclared_topic":
      return NOT_JUDGED;
  }
}

function turnaround(j: Judged, input: JudgeInput): number | undefined {
  const asked = new Set(input.cancelled ?? []);
  const all = orders(j).filter((o) => !asked.has(o.orderId));
  if (all.length === 0) return undefined;
  const within = all.filter((o) => o.returnedAt !== undefined && o.returnedAt - o.placedAt <= TURNAROUND_SLO.orbits * ORBIT_MS).length;
  return within / all.length;
}

/**
 * Simulated minutes from the first fault an ingest could see, a relay delivery fault, to the first alert at or after
 * it. An identity outage is the gateway's to notice, a dark node is the reconciliation week's, and a reorder is
 * invisible at the canon rate; anchoring on any would measure a seam against a symptom it never receives. A schedule with no delivery fault anchors on its first.
 */
function timeToDetect(input: JudgeInput): number | undefined {
  if (input.faults.length === 0 || !input.alerts || input.alerts.length === 0) return undefined;
  const detectable = input.faults.filter((f) => f.mock === "relay" && DETECTABLE_FAULT_KINDS.includes(f.kind));
  const anchor = detectable.length > 0 ? detectable : input.faults;
  const firstFaultMs = input.startMs + Math.min(...anchor.map((f) => f.atOrbit)) * ORBIT_MS;
  const first = input.alerts.filter((a) => a.atMs >= firstFaultMs).sort((a, b) => a.atMs - b.atMs)[0];
  return first ? (first.atMs - firstFaultMs) / MINUTE_MS : undefined;
}

function triageScore(j: Judged, input: JudgeInput): { precision: number | undefined; recall: number | undefined } {
  if (!input.fixtures || input.fixtures.length === 0) return { precision: undefined, recall: undefined };
  let triaged = 0;
  let correct = 0;
  for (const t of j.triages) {
    const f = j.reports.get(t.reportId)?.fixture;
    if (!f) continue;
    triaged++;
    if (t.action === f.expected.action && t.severity === f.expected.severity && t.category === f.expected.category) correct++;
  }
  const reported = [...j.reports.values()].filter((r) => r.fixture).length;
  return { precision: triaged === 0 ? undefined : correct / triaged, recall: reported === 0 ? undefined : correct / reported };
}

/** Undefined is unmeasured, and a band the run could not measure is left out rather than reported as a number. */
function band(id: BandId, j: Judged, input: JudgeInput): number | undefined {
  switch (id) {
    case "turnaround":
      return turnaround(j, input);
    case "time_to_detect":
      return timeToDetect(input);
    case "dead_letters":
      return input.deadLetters;
    case "eval_precision":
      return triageScore(j, input).precision;
    case "eval_recall":
      return triageScore(j, input).recall;
    case "tokens_per_10k": {
      const placed = j.mirror.orders.size;
      return placed === 0 ? undefined : (j.triages.reduce((sum, t) => sum + t.tokens, 0) * 10_000) / placed;
    }
    case "p95":
    case "units":
      // Measured by the driver from the trace file and `/cost`, which the simulator cannot see.
      return undefined;
  }
}

/** Judges the scenario's invariants and bands over the run (system-spec §10.2 definitions); a band it cannot measure is absent. */
export function judge(input: JudgeInput): OracleJson {
  const j = replay(input);
  const all = orders(j);
  return {
    invariants: Object.fromEntries(input.scenario.invariants.map((id) => [id, invariant(id, j, input)])),
    bands: Object.fromEntries(input.scenario.bands.map((id) => [id, band(id, j, input)]).filter((e): e is [BandId, number] => e[1] !== undefined)),
    faults: [...input.faults],
    stuckOrders: all.filter((o) => stuckAt(o, input.endMs)).map((o) => ({ orderId: o.orderId, state: o.state, sinceOrbit: Math.max(0, Math.floor((o.lastChangeAt - input.startMs) / ORBIT_MS)) })),
    ordersPlaced: all.length,
    ordersReturned: all.filter((o) => o.state === "returned").length,
  };
}

export function runLengthMs(scenario: Scenario): number {
  return (scenario.orbits + DRAIN_TAIL_ORBITS) * ORBIT_MS;
}
