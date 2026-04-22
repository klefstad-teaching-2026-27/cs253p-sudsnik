import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { fetch } from "undici";
import { SIM_TOKEN_HEADER } from "@sudsnik/contracts";

/** Wall-clock milliseconds before a mock that has stopped answering is given up on. */
export const READ_DEADLINE_MS = 30_000;

export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

/** Wall-clock durations of spans named `http POST /v1/orders` in the OTel JSONL file; empty means unmeasured. */
export function placementDurations(dataDir: string): number[] {
  const path = join(dataDir, "otel", "trace.jsonl");
  if (!existsSync(path)) return [];
  const out: number[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const s = JSON.parse(line) as { name?: string; durationMs?: number };
      if (s.name === "http POST /v1/orders" && typeof s.durationMs === "number") out.push(s.durationMs);
    } catch {
      /* partial line */
    }
  }
  return out;
}

export interface AlertRecord {
  atMs: number;
  rule: string;
  service: string;
}

/** Log records with event "alert" across every service log. */
export function readAlerts(dataDir: string): AlertRecord[] {
  const dir = join(dataDir, "logs");
  if (!existsSync(dir)) return [];
  const out: AlertRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as { event?: string; rule?: string; service?: string; simNow?: number };
        if (r.event === "alert" && typeof r.rule === "string") out.push({ atMs: r.simNow ?? 0, rule: r.rule, service: r.service ?? f.replace(".jsonl", "") });
      } catch {
        /* partial line */
      }
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/**
 * How many calls the mocks refused for quota, counted by the mock that refused rather than by the service being
 * graded: a submission with no guard writes no log of its own and would otherwise report none and pass.
 */
export async function readQuotaRefusals(mockUrls: string[], simToken?: string): Promise<number> {
  let n = 0;
  for (const base of mockUrls) {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/_sim/stats`, { signal: AbortSignal.timeout(READ_DEADLINE_MS), headers: simToken ? { [SIM_TOKEN_HEADER]: simToken } : {} });
      if (!r.ok) continue;
      const body = (await r.json()) as { quotaRefusals?: { total?: number } };
      n += body.quotaRefusals?.total ?? 0;
    } catch {
      /* a mock that is already down cannot have refused anything further */
    }
  }
  return n;
}

/** Log records showing a circuit breaker opening (system-spec §10.2). */
export function readBreakerOpens(dataDir: string): { atMs: number; breaker: string; service: string }[] {
  const dir = join(dataDir, "logs");
  if (!existsSync(dir)) return [];
  const out: { atMs: number; breaker: string; service: string }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.includes("breaker_state")) continue;
      try {
        const r = JSON.parse(line) as { event?: string; to?: string; breaker?: string; service?: string; simNow?: number };
        if (r.event === "breaker_state" && r.to === "open") out.push({ atMs: r.simNow ?? 0, breaker: r.breaker ?? "unknown", service: r.service ?? f.replace(".jsonl", "") });
      } catch {
        /* partial line */
      }
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** Tail of each service log around error records, for the deploy log excerpt. */
export function errorExcerpts(dataDir: string, lines = 200): Record<string, string> {
  const dir = join(dataDir, "logs");
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const all = readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean);
    const lastError = all.map((l, i) => (l.includes('"level":"error"') ? i : -1)).filter((i) => i >= 0).pop();
    if (lastError === undefined) continue;
    out[f] = all.slice(Math.max(0, lastError - lines / 2), lastError + lines / 2).join("\n");
  }
  return out;
}

/**
 * Lost on drain (system-spec §10.2): an accepted order absent from orders.sqlite, or non-terminal with no saga step.
 * Reads the file read-only after the stack has exited; a service that names its tables differently is reported as unreadable.
 */
export function lostOnDrain(dataDir: string, placed: string[]): { lost: string[]; readable: boolean } {
  const path = join(dataDir, "orders.sqlite");
  if (!existsSync(path)) return { lost: [...placed], readable: false };
  const db = new Database(path, { readonly: true });
  try {
    const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name));
    if (!tables.has("orders")) return { lost: [...placed], readable: false };
    const cols = new Set((db.prepare("pragma table_info(orders)").all() as { name: string }[]).map((c) => c.name));
    const idCol = cols.has("order_id") ? "order_id" : cols.has("orderId") ? "orderId" : cols.has("id") ? "id" : undefined;
    const stateCol = cols.has("state") ? "state" : cols.has("status") ? "status" : undefined;
    if (!idCol) return { lost: [...placed], readable: false };
    const rows = new Map<string, string>();
    for (const r of db.prepare(`select ${idCol} as id${stateCol ? `, ${stateCol} as state` : ""} from orders`).all() as { id: string; state?: string }[]) rows.set(String(r.id), r.state ?? "");
    const stepsTable = ["saga_steps", "sagaSteps", "saga"].find((t) => tables.has(t));
    const stepOrders = new Set<string>();
    if (stepsTable) {
      const scols = new Set((db.prepare(`pragma table_info(${stepsTable})`).all() as { name: string }[]).map((c) => c.name));
      const oc = scols.has("order_id") ? "order_id" : scols.has("orderId") ? "orderId" : undefined;
      if (oc) for (const r of db.prepare(`select distinct ${oc} as id from ${stepsTable}`).all() as { id: string }[]) stepOrders.add(String(r.id));
    }
    const lost = placed.filter((id) => {
      const state = rows.get(id);
      if (state === undefined) return true;
      if (state === "returned" || state === "cancelled") return false;
      return stepsTable !== undefined && !stepOrders.has(id);
    });
    return { lost, readable: true };
  } finally {
    db.close();
  }
}
