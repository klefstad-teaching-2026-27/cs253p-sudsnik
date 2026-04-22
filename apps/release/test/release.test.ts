import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { scenarios } from "@sudsnik/sim";
import { makeEnvelope } from "@sudsnik/contracts";
import { openBus } from "@sudsnik/infra-queue";
import { SimClock } from "@sudsnik/kernel";
import { busBacklog, canonicalJson, lostOnDrain, p95, placementDurations, readAlerts, renderText, scoreItems, scoreStage, sign, STAGE_POINTS, sumItems, summaryLine, type DeployLog } from "../src/index.js";

describe("deploy log", () => {
  it("signs canonical JSON deterministically and renders text", () => {
    const partial = { run: { assignment: "a", seed: "public" as const, scenario: "quiet-orbit", scale: 1, clockRate: 600, startedAt: "t", contractsVersion: "1.0.0" }, incident: { alerts: [], sloBreaches: [], stuckOrders: [], deadLetters: 0, lostOnDrain: 0 }, score: { public: 0, contract: 0, canary: 30, production: 0, total: 30 } };
    expect(sign(partial, "k")).toBe(sign({ ...partial, score: { ...partial.score } }, "k"));
    expect(sign(partial, "k")).not.toBe(sign(partial, "k2"));
    // The clock rate is inside the signature: a compressed-clock run cannot be passed off as one at the canon rate.
    expect(sign(partial, "k")).not.toBe(sign({ ...partial, run: { ...partial.run, clockRate: 2400 } }, "k"));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const log: DeployLog = { ...partial, stages: [{ stage: "canary", status: "passed", durationMs: 1, findings: [{ severity: "warn", code: "DEAD_LETTERS", message: "2" }], artifacts: ["cost.json"] }], results: { invariants: { lost_on_drain: { pass: true, detail: "0" } }, bands: { p95: 12 }, items: [{ id: "lost_on_drain", weight: 10, passed: true, detail: "0" }, { id: "p95.full", weight: 1, passed: false, detail: "12" }] }, summary: summaryLine({ stage: "canary", scenario: "quiet-orbit", unitsPer10k: 100, p95Ms: 12, turnaround: 0.97, lost: 0, stuck: 0, score: 30, outOf: 30 }), signature: "x" };
    const text = renderText(log);
    // The rendered log says what clock the run used; the banner that says so on the terminal does not travel with it.
    expect(text).toContain("# deploy a quiet-orbit scale=1 clock=600 seed=public");
    expect(renderText({ ...log, run: { ...log.run, clockRate: 2400 } })).toContain("clock=2400");
    expect(text).toContain("SUMMARY stage=canary scenario=quiet-orbit units_per_10k=100 p95_ms=12 turnaround=0.97 lost=0 stuck=0 score=30/30");
    expect(text).toContain("PASS 10.0/10.0 lost_on_drain");
    expect(text).toContain("FAIL  0.0/1.0 p95.full");
    // The incident is read before the verdicts.
    expect(text.indexOf("## incident")).toBeLessThan(text.indexOf("## results"));
  });
});

describe("metrics", () => {
  it("computes p95 and reads placement spans and alerts", () => {
    expect(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10);
    expect(p95([])).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), "sudsnik-rel-"));
    mkdirSync(join(dir, "otel"));
    mkdirSync(join(dir, "logs"));
    writeFileSync(join(dir, "otel", "trace.jsonl"), [JSON.stringify({ name: "http POST /v1/orders", durationMs: 12 }), JSON.stringify({ name: "http GET /x", durationMs: 99 })].join("\n") + "\n");
    writeFileSync(join(dir, "logs", "orders.jsonl"), JSON.stringify({ event: "alert", rule: "stuck", service: "orders", simNow: 5 }) + "\n" + JSON.stringify({ event: "placed" }) + "\n");
    expect(placementDurations(dir)).toEqual([12]);
    expect(readAlerts(dir)).toEqual([{ atMs: 5, rule: "stuck", service: "orders" }]);
  });
  it("counts orders lost on drain from orders.sqlite", () => {
    const dir = mkdtempSync(join(tmpdir(), "sudsnik-rel-"));
    const db = new Database(join(dir, "orders.sqlite"));
    db.exec("create table orders (order_id text primary key, state text); create table saga_steps (order_id text, step text);");
    db.prepare("insert into orders values (?, ?)").run("o1", "returned");
    db.prepare("insert into orders values (?, ?)").run("o2", "placed");
    db.prepare("insert into orders values (?, ?)").run("o3", "placed");
    db.prepare("insert into saga_steps values (?, ?)").run("o2", "authorize");
    db.close();
    expect(lostOnDrain(dir, ["o1", "o2", "o3", "o4"])).toEqual({ lost: ["o3", "o4"], readable: true });
    expect(lostOnDrain(mkdtempSync(join(tmpdir(), "x-")), ["o1"])).toEqual({ lost: ["o1"], readable: false });
  });
});

describe("scoring", () => {
  it("weights follow autograder-spec §7.1 and bands never exceed a third", () => {
    const inv = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true }, no_stuck_orders: { pass: true }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } };
    const full = scoreStage("canary", scenarios["quiet-orbit"], inv, { turnaround: 0.97, p95: 100, units: 1 });
    expect(full).toBe(29);
    const bad = scoreStage("production", scenarios["quiet-orbit"], { ...inv, lost_on_drain: { pass: false } }, { turnaround: 0.2, p95: 5000, units: 1 });
    expect(bad).toBeLessThan(full);
    // "Band items never exceed one third of any stage's points" is the sentence in §7.1, checked rather than named:
    // whatever a scenario declares, the rows a threshold decides are capped at a third, so no band can carry a stage.
    const perfect = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true } };
    for (const scenario of Object.values(scenarios)) {
      const all = { ...perfect, ...Object.fromEntries(scenario.invariants.map((i) => [i, { pass: true }])) };
      for (const stage of ["canary", "production"] as const) {
        const items = scoreItems(stage, scenario, all, {});
        const banded = items.filter((i) => i.id.endsWith(".half") || i.id.endsWith(".full")).reduce((sum, i) => sum + i.weight, 0);
        expect(banded).toBeLessThanOrEqual(STAGE_POINTS[stage] / 3);
      }
    }
  });

  it("scores a scenario's own bands with the weight turnaround leaves, and the stage still totals its own points", () => {
    const perfect = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true } };
    const inv = (s: (typeof scenarios)[keyof typeof scenarios]) => ({ ...perfect, ...Object.fromEntries(s.invariants.map((i) => [i, { pass: true }])) });
    // Nothing here is calibrated, so `units` and each of the three eval bands score half their weight.
    const hostile = scenarios["hostile-notes"];
    expect(scoreStage("production", hostile, inv(hostile), { p95: 1, units: 1, eval_precision: 1, eval_recall: 1, tokens_per_10k: 1 })).toBe(45);
    // A run that measured none of them scores none of that weight, where turnaround would have kept it.
    expect(scoreStage("production", hostile, inv(hostile), { p95: 1, units: 1 })).toBe(42.5);
    // Calibrated, they score against the measured ends like any other band.
    const th = { eval_precision: { full: 0.9, half: 0.7, zero: 0.5, lowerIsBetter: false } };
    expect(scoreStage("production", hostile, inv(hostile), { p95: 1, units: 1, eval_precision: 0.95, eval_recall: 1, tokens_per_10k: 1 }, th)).toBe(45.8);
    expect(scoreStage("production", hostile, inv(hostile), { p95: 1, units: 1, eval_precision: 0.4, eval_recall: 1, tokens_per_10k: 1 }, th)).toBe(44.2);
    // A scenario declaring no bands of its own keeps the turnaround weight rather than losing it.
    const migration = scenarios.migration;
    expect(scoreStage("canary", migration, inv(migration), { p95: 1, units: 1 })).toBe(29);
    // Dead letters have a natural scale: none is full, a few is half, more is nothing.
    const storm = scenarios.storm;
    const stormBands = (dead: number, ttd = 3) => ({ p95: 1, units: 1, time_to_detect: ttd, dead_letters: dead });
    // Time to detect has a natural scale too: within the orbit is full, within three is half, later is nothing.
    const raw = (bands: Record<string, number>) => scoreItems("production", storm, inv(storm), bands).filter((i) => i.passed).reduce((sum, i) => sum + i.weight, 0);
    expect(raw(stormBands(0, 60)) - raw(stormBands(0, 200))).toBeCloseTo(1.25);
    expect(raw(stormBands(0, 200)) - raw(stormBands(0, 400))).toBeCloseTo(1.25);
    expect(raw(stormBands(0)) - raw(stormBands(3))).toBeCloseTo(1.25);
    expect(raw(stormBands(3)) - raw(stormBands(30))).toBeCloseTo(1.25);
  });

  it("lists every stage as rows whose weights sum to the stage's points, a band as two rows", () => {
    const perfect = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true } };
    for (const scenario of Object.values(scenarios)) {
      const inv = { ...perfect, ...Object.fromEntries(scenario.invariants.map((i) => [i, { pass: true }])) };
      for (const stage of ["canary", "production"] as const) {
        const items = scoreItems(stage, scenario, inv, {});
        expect(items.reduce((sum, i) => sum + i.weight, 0)).toBeCloseTo(STAGE_POINTS[stage]);
        const ids = items.map((i) => i.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const band of scenario.bands) expect(ids.filter((id) => id.startsWith(`${band}.`))).toEqual([`${band}.half`, `${band}.full`]);
      }
    }
    // A group with fewer points scales every row, so the summary and the grader's rows agree.
    const half = scoreItems("production", scenarios["quiet-orbit"], { ...perfect, no_stuck_orders: { pass: true }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } }, {}, {}, 25);
    expect(half.reduce((sum, i) => sum + i.weight, 0)).toBeCloseTo(25);
    expect(half.find((i) => i.id === "lost_on_drain")?.weight).toBe(5);
    // Half credit on a band is exactly one of its two rows, and the sum is what scoreStage reports.
    const inv = { ...perfect, no_stuck_orders: { pass: true }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } };
    const items = scoreItems("canary", scenarios["quiet-orbit"], inv, { turnaround: 0.6, p95: 100, units: 1 });
    expect(items.find((i) => i.id === "turnaround.half")?.passed).toBe(true);
    expect(items.find((i) => i.id === "turnaround.full")?.passed).toBe(false);
    expect(sumItems(items)).toBe(scoreStage("canary", scenarios["quiet-orbit"], inv, { turnaround: 0.6, p95: 100, units: 1 }));
  });

  it("gives a cost band nothing while a scenario invariant fails, since spending nothing is absence, not efficiency", () => {
    const th = { units: { full: 1000, half: 5000, zero: 9000, lowerIsBetter: true } };
    const perfect = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true } };
    const done = scoreItems("canary", scenarios["quiet-orbit"], { ...perfect, no_stuck_orders: { pass: true }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } }, { turnaround: 1, p95: 1, units: 0 }, th);
    const hollow = scoreItems("canary", scenarios["quiet-orbit"], { ...perfect, no_stuck_orders: { pass: false }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } }, { turnaround: 1, p95: 1, units: 0 }, th);
    expect(done.filter((i) => i.id.startsWith("units.")).every((i) => i.passed)).toBe(true);
    expect(hollow.filter((i) => i.id.startsWith("units.")).every((i) => !i.passed)).toBe(true);
    // The SLO bands are not cost and keep their own verdicts.
    expect(hollow.find((i) => i.id === "p95.full")?.passed).toBe(true);
  });
});

import { bandKey, isMeasured, scoreBand, thresholdsFor, type BandThresholds } from "../src/index.js";

describe("bands", () => {
  const t: BandThresholds = { full: 100, half: 550, zero: 1000, lowerIsBetter: true };
  it("scores full, half, or none against measured ends", () => {
    expect(scoreBand(90, t, 4)).toBe(4);
    expect(scoreBand(100, t, 4)).toBe(4);
    expect(scoreBand(300, t, 4)).toBe(2);
    expect(scoreBand(1200, t, 4)).toBe(0);
    const higher: BandThresholds = { full: 0.95, half: 0.5, zero: 0.1, lowerIsBetter: false };
    expect(scoreBand(0.99, higher, 4)).toBe(4);
    expect(scoreBand(0.6, higher, 4)).toBe(2);
    expect(scoreBand(0.05, higher, 4)).toBe(0);
  });

  it("keys a row by assignment and stage, and judges a canary by its own run rather than production's", () => {
    // Production keeps the bare id, so every row calibrated before stages were told apart still judges production.
    expect(bandKey("wk4-washnodes", "production")).toBe("wk4-washnodes");
    expect(bandKey("wk4-washnodes", "canary")).toBe("wk4-washnodes/canary");
    const production = { units: t };
    const canary = { units: { full: 20, half: 110, zero: 200, lowerIsBetter: true } };
    const file = { "wk4-washnodes": production, "wk4-washnodes/canary": canary };
    expect(thresholdsFor(file, "wk4-washnodes", "production")).toBe(production);
    expect(thresholdsFor(file, "wk4-washnodes", "canary")).toBe(canary);
    // A stage with no row of its own reads the assignment's, so nothing calibrated before this existed moves.
    expect(thresholdsFor({ "wk1-orders": production }, "wk1-orders", "canary")).toBe(production);
    // No row at all is a stage nobody calibrated, and is not the same answer as a row that is there and empty: an
    // empty row is a stage that was measured and separated nothing, which scores differently (§7.2).
    expect(thresholdsFor({}, "wk1-orders", "canary")).toBeUndefined();
    expect(thresholdsFor({ "wk7-support": production }, "wk7-support", "canary")).toBe(production);
    expect(thresholdsFor({ "wk7-support": production, "wk7-support/canary": {} }, "wk7-support", "canary")).toEqual({});
  });

  it("scores a band it could not measure as nothing, not as perfect", () => {
    const inv = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true }, no_stuck_orders: { pass: true }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } };
    const thresholds = { units: { full: 1000, half: 5000, zero: 9000, lowerIsBetter: true } };
    // A run that measured nothing must not collect the credit a flawless one would.
    const unmeasured = scoreStage("canary", scenarios["quiet-orbit"], inv, {}, thresholds);
    const measured = scoreStage("canary", scenarios["quiet-orbit"], inv, { turnaround: 1, p95: 9, units: 900 }, thresholds);
    expect(measured - unmeasured).toBe(6);
    expect(scoreBand(undefined, thresholds.units, 4)).toBe(0);
    // Every band is a non-negative quantity, so a negative one is a sentinel, not a run better than perfect.
    const sentinel = scoreStage("canary", scenarios["quiet-orbit"], inv, { turnaround: -1, p95: -1, units: -1 }, thresholds);
    expect(sentinel).toBe(unmeasured);
    expect(scoreBand(-1, thresholds.units, 4)).toBe(0);
    expect(isMeasured(-1)).toBe(false);
    expect(isMeasured(0)).toBe(true);
  });

  it("falls back to half credit when a band has no measured thresholds", () => {
    const inv = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true }, no_stuck_orders: { pass: true }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } };
    const uncalibrated = scoreStage("canary", scenarios["quiet-orbit"], inv, { turnaround: 0.97, p95: 100, units: 5_000_000 });
    const calibrated = scoreStage("canary", scenarios["quiet-orbit"], inv, { turnaround: 0.97, p95: 100, units: 5_000_000 }, { units: { full: 1000, half: 5000, zero: 9000, lowerIsBetter: true } });
    expect(uncalibrated - calibrated).toBe(1);
  });

  it("keeps a band's weight where the stage was calibrated and its ends could not be separated", () => {
    const inv = { lost_on_drain: { pass: true }, tenant_leak: { pass: true }, undeclared_topic: { pass: true }, no_stuck_orders: { pass: true }, cancelled_orders_compensated: { pass: true }, orders_settled: { pass: true } };
    const bands = { turnaround: 0.97, p95: 100, units: 5_000_000 };
    // A row that is there and holds no threshold for the band: the ends were measured and are 1.16x apart, so
    // nothing a submission does moves the band. One passing row carries the whole weight.
    const empty = scoreItems("canary", scenarios["quiet-orbit"], inv, bands, {});
    const kept = empty.filter((i) => i.id === "units");
    expect(kept.map((i) => [i.passed, i.weight])).toEqual([[true, 2]]);
    expect(kept[0]?.detail).toBe("measured, and the two ends could not be separated; weight kept");
    expect(empty.some((i) => i.id.startsWith("units."))).toBe(false);
    expect(sumItems(empty)).toBe(30);
    // No row at all is the uncalibrated case and must not move: half credit, over two rows, and 29 of 30.
    const none = scoreItems("canary", scenarios["quiet-orbit"], inv, bands);
    expect(none.filter((i) => i.id.startsWith("units.")).map((i) => [i.id, i.passed])).toEqual([
      ["units.half", true],
      ["units.full", false],
    ]);
    expect(none.find((i) => i.id === "units")).toBeUndefined();
    expect(sumItems(none)).toBe(29);
    // A row that was calibrated keeps judging the band it did write, and a row that wrote some other band leaves
    // this one at half: only a row that separated nothing at all keeps a weight.
    const written = scoreItems("canary", scenarios["quiet-orbit"], inv, bands, { units: { full: 1000, half: 5000, zero: 9000, lowerIsBetter: true } });
    expect(written.filter((i) => i.id.startsWith("units.")).every((i) => !i.passed)).toBe(true);
    const partial = scoreItems("canary", scenarios["quiet-orbit"], inv, bands, { p95: { full: 1, half: 2, zero: 3, lowerIsBetter: true } });
    expect(partial.filter((i) => i.id.startsWith("units.")).map((i) => i.passed)).toEqual([true, false]);
    expect(sumItems(partial)).toBe(29);
    // A band whose weight is kept is not a band the run measured: an unmeasured one is kept too, since no
    // threshold judges it either way.
    const unmeasured = scoreItems("canary", scenarios["quiet-orbit"], inv, { turnaround: 0.97, p95: 100 }, {});
    expect(unmeasured.filter((i) => i.id === "units").map((i) => i.passed)).toEqual([true]);
  });
});

describe("a dirty environment", () => {
  it("counts an earlier run's order events, ignores a booted stack's, and does not create the bus to find none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sudsnik-bus-"));
    const path = join(dir, "bus.sqlite");
    const clock = new SimClock();
    const meter = { charge: () => undefined };
    // The stack creates the bus as the sandbox user; a check that created it as root would take the file from it.
    expect(busBacklog(path, clock, meter)).toBe(0);
    expect(existsSync(path)).toBe(false);

    const bus = openBus({ path, clock, meter });
    // A stack that has merely booted ticks and seeds its operators, so a clean bus is never literally empty.
    await bus.forService("sim").publish(makeEnvelope({ topic: "clock.tick", occurredAt: 0, payload: { nowMs: 0, orbit: 0, orbitPhase: 0 } }));
    await bus.forService("accounts").publish(makeEnvelope({ topic: "operator.updated", tenantId: "ops-alpha", occurredAt: 0, payload: { operatorId: "ops-alpha" } }));
    expect(busBacklog(path, clock, meter)).toBe(0);

    await bus.forService("orders").publish(makeEnvelope({ topic: "order.placed", tenantId: "ops-alpha", occurredAt: 0, payload: { orderId: "o1" } }));
    bus.close();
    expect(busBacklog(path, clock, meter)).toBe(1);
  });
});

import { readFileSync as readRunbook } from "node:fs";
import { FINDING_CODES } from "../src/index.js";

describe("finding codes", () => {
  it("each has an entry in the runbook the student tree ships", () => {
    const runbook = readRunbook(new URL("../../../docs/runbooks/deploy-log.md", import.meta.url), "utf8");
    for (const code of Object.keys(FINDING_CODES)) expect(runbook, code).toContain(`## \`${code}\``);
    // And no entry for a code that no longer exists.
    for (const heading of runbook.matchAll(/^## `([A-Z_]+)`/gm)) expect(Object.keys(FINDING_CODES), heading[1]).toContain(heading[1]);
  });
});
