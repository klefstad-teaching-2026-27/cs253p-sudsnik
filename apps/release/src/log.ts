import { createHmac } from "node:crypto";
import type { FindingCode } from "./codes.js";

export interface Finding {
  severity: "error" | "warn" | "info";
  code: FindingCode;
  message: string;
  at?: string;
  excerpt?: string;
}

export interface Stage {
  stage: "intake" | "build" | "contract" | "canary" | "production";
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  findings: Finding[];
  artifacts: string[];
  /** Wall-clock milliseconds the stack was down for the restart the scenario asked for, where it asked for one. */
  restartDownMs?: number;
}

export interface DeployLog {
  /** `clockRate` is the virtual-clock multiplier the run used: a run at anything but the canon rate measures bands nobody can compare (autograder-spec.md §8.1). */
  run: { assignment: string; seed: "public" | "team"; scenario: string; scale: number; clockRate: number; startedAt: string; contractsVersion: string };
  stages: Stage[];
  incident: {
    alerts: { atMs: number; rule: string; service: string }[];
    sloBreaches: { slo: string; observed: number; target: number }[];
    stuckOrders: { orderId: string; state: string; sinceOrbit: number }[];
    deadLetters: number;
    lostOnDrain: number;
  };
  score: { public: number; contract: number; canary: number; production: number; total: number };
  /** Per-item pass/fail and band values the grader turns into TestResults. */
  results: {
    invariants: Record<string, { pass: boolean; detail: string }>;
    bands: Record<string, number>;
    unitsByService?: Record<string, number>;
    /** The graded rows the score is the sum of; the grader copies them and adds nothing. */
    items: { id: string; weight: number; passed: boolean; detail: string }[];
  };
  summary: string;
  signature: string;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sign(log: Pick<DeployLog, "run" | "incident" | "score">, ledgerKey: string): string {
  return createHmac("sha256", ledgerKey).update(canonicalJson({ run: log.run, incident: log.incident, score: log.score })).digest("hex");
}

export function summaryLine(s: { stage: string; scenario: string; unitsPer10k: number; p95Ms: number; turnaround: number; lost: number; stuck: number; score: number; outOf: number }): string {
  return `SUMMARY stage=${s.stage} scenario=${s.scenario} units_per_10k=${s.unitsPer10k} p95_ms=${s.p95Ms} turnaround=${s.turnaround.toFixed(2)} lost=${s.lost} stuck=${s.stuck} score=${s.score}/${s.outOf}`;
}

export function renderText(log: DeployLog): string {
  const lines = [`# deploy ${log.run.assignment} ${log.run.scenario} scale=${log.run.scale} clock=${log.run.clockRate} seed=${log.run.seed} started=${log.run.startedAt} contracts=${log.run.contractsVersion}`];
  for (const st of log.stages) {
    lines.push(`\n## ${st.stage}: ${st.status} (${(st.durationMs / 1000).toFixed(1)} s)`);
    for (const f of st.findings) lines.push(`  [${f.severity}] ${f.code} ${f.message}${f.at ? ` @ ${f.at}` : ""}`);
    if (st.restartDownMs !== undefined) lines.push(`  restarted mid-run; back after ${(st.restartDownMs / 1000).toFixed(1)} s`);
    if (st.artifacts.length) lines.push(`  artifacts: ${st.artifacts.join(", ")}`);
  }
  // The incident reads first, top to bottom, as the timeline a postmortem starts from; the verdicts follow it.
  lines.push("\n## incident");
  lines.push(`  alerts: ${log.incident.alerts.length}; stuck: ${log.incident.stuckOrders.length}; dead letters: ${log.incident.deadLetters}; lost on drain: ${log.incident.lostOnDrain}`);
  for (const a of log.incident.alerts) lines.push(`  alert ${a.rule} (${a.service}) at ${a.atMs} ms`);
  for (const b of log.incident.sloBreaches) lines.push(`  breach ${b.slo}: observed ${b.observed}, target ${b.target}`);
  for (const o of log.incident.stuckOrders) lines.push(`  stuck ${o.orderId} in ${o.state} since orbit ${o.sinceOrbit}`);
  lines.push("\n## results");
  const width = Math.max(...log.results.items.map((i) => i.weight.toFixed(1).length), 1);
  for (const i of log.results.items) lines.push(`  ${i.passed ? "PASS" : "FAIL"} ${(i.passed ? i.weight : 0).toFixed(1).padStart(width)}/${i.weight.toFixed(1)} ${i.id}: ${i.detail}`);
  for (const [k, v] of Object.entries(log.results.bands)) lines.push(`  band ${k} = ${v}`);
  lines.push(`\n${log.summary}`);
  lines.push(`signature ${log.signature}`);
  return lines.join("\n") + "\n";
}
