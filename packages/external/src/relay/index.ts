import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { TENANT_HEADER, isHabitatVisible, nextWindowStart } from "@sudsnik/contracts";
import { DeliverRequest, type Endpoint, type HabitatDelivery } from "@sudsnik/contracts/mocks/relay";
import { createMockApp, type MockOptions } from "../mock.js";

export const DUPLICATE_RATE = 0.08;
export const REORDER_RATE = 0.05;
export const BITFLIP_RATE = 0;
export const MAX_ATTEMPTS = 5;
/** `Retry-After` for a dark node or shuttle, whose next contact relay cannot compute. */
export const RETRY_AFTER_DARK_S = 60;

type Status = "pending" | "delivered" | "recorded" | "failed";

interface Row {
  id: string;
  tenant: string;
  origin_kind: Endpoint["kind"];
  origin_id: string;
  dest_kind: Endpoint["kind"];
  dest_id: string;
  to_url: string;
  path: string;
  body: string;
  deliver_at_ms: number;
  status: Status;
  attempts: number;
  delivered_at_ms: number | null;
}

export async function createMock(opts: MockOptions): Promise<FastifyInstance> {
  const mock = await createMockApp("relay", opts);
  const { app } = mock;
  const db = openDeliveries(opts.dataDir);
  const insert = db.prepare(
    `INSERT INTO deliveries (id, tenant, origin_kind, origin_id, dest_kind, dest_id, to_url, path, body, deliver_at_ms, status, attempts, delivered_at_ms)
     VALUES (@id, @tenant, @origin_kind, @origin_id, @dest_kind, @dest_id, @to_url, @path, @body, @deliver_at_ms, @status, @attempts, @delivered_at_ms)`,
  );
  const settle = db.prepare(`UPDATE deliveries SET status = ?, attempts = ?, delivered_at_ms = ? WHERE id = ?`);
  const pending = db.prepare(`SELECT * FROM deliveries WHERE status = 'pending' AND deliver_at_ms <= ? ORDER BY deliver_at_ms, rowid`);
  const recorded = db.prepare(`SELECT * FROM deliveries WHERE status = 'recorded' ORDER BY delivered_at_ms, rowid`);
  app.addHook("onClose", async () => db.close());

  const darkByFault = (id: string): boolean => mock.faults("dark").some((f) => f.params.id === id);
  const isDark = (e: Endpoint, now: number): boolean => {
    if (e.kind === "ground") return false;
    if (mock.isDark(e.id) || darkByFault(e.id)) return true;
    return e.kind === "habitat" && !isHabitatVisible(e.id, now);
  };
  const retryAfterS = (e: Endpoint, now: number): number =>
    e.kind === "habitat" && !isHabitatVisible(e.id, now) ? Math.ceil((nextWindowStart(e.id, now) - now) / 1000) : RETRY_AFTER_DARK_S;

  const forward = async (row: Row): Promise<void> => {
    const rng = mock.rng("faults");
    const copies = 1 + (rng.chance(mock.rate("duplicate-rate", DUPLICATE_RATE)) ? 1 : 0);
    let ok = true;
    for (let i = 0; i < copies; i++) {
      const body = rng.chance(mock.rate("bitflip-rate", BITFLIP_RATE)) ? flipChecksum(row.body, rng.int(16)) : row.body;
      try {
        const res = await fetch(`${row.to_url}${row.path}`, { method: "POST", headers: { "content-type": "application/json", [TENANT_HEADER]: row.tenant }, body });
        ok = ok && res.ok;
      } catch {
        ok = false;
      }
    }
    const attempts = row.attempts + 1;
    if (ok) settle.run("delivered", attempts, mock.nowMs(), row.id);
    else settle.run(attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, null, row.id);
  };

  const flush = async (): Promise<void> => {
    const now = mock.nowMs();
    for (const row of pending.all(now) as Row[]) {
      if (isDark({ kind: row.origin_kind, id: row.origin_id }, now)) continue;
      await forward(row);
    }
  };
  mock.onState(flush);

  app.post("/deliver", { schema: { body: DeliverRequest } }, async (req, reply) => {
    const d = req.body;
    const now = mock.nowMs();
    if (isDark(d.destination, now)) {
      return mock.fail(reply, "UNAVAILABLE", `${d.destination.kind} ${d.destination.id} is out of contact`, { "retry-after": String(retryAfterS(d.destination, now)) });
    }
    const habitatBound = d.destination.kind === "habitat";
    const row: Row = {
      id: mock.id("dlv"),
      tenant: req.tenant,
      origin_kind: d.origin.kind,
      origin_id: d.origin.id,
      dest_kind: d.destination.kind,
      dest_id: d.destination.id,
      to_url: d.to,
      path: d.path,
      body: JSON.stringify(d.body),
      deliver_at_ms: d.deliverAtMs,
      status: habitatBound ? "recorded" : "pending",
      attempts: 0,
      delivered_at_ms: habitatBound ? Math.max(now, d.deliverAtMs) : null,
    };
    insert.run(row);
    const sendNow = !habitatBound && d.deliverAtMs <= now && !isDark(d.origin, now) && !mock.rng("faults").chance(mock.rate("reorder-rate", REORDER_RATE));
    if (sendNow) await forward(row);
    return reply.code(202).send({ accepted: true as const, deliveryId: row.id });
  });

  app.get("/_sim/deliveries", async (): Promise<HabitatDelivery[]> =>
    (recorded.all() as Row[]).map((r) => {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      const notificationId = body.notificationId ?? body.id ?? r.id;
      return { deliveryId: r.id, habitatId: r.dest_id, notificationId: String(notificationId), deliveredAtMs: r.delivered_at_ms ?? r.deliver_at_ms, body };
    }),
  );

  return app;
}

function openDeliveries(dataDir: string): Database.Database {
  const dir = join(dataDir, "mocks");
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "relay.sqlite"));
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, origin_kind TEXT NOT NULL, origin_id TEXT NOT NULL,
    dest_kind TEXT NOT NULL, dest_id TEXT NOT NULL, to_url TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL,
    deliver_at_ms INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, delivered_at_ms INTEGER
  )`);
  return db;
}

/** Replaces one hex character of a top-level `checksum` string with a different one (system-spec §10.3). */
export function flipChecksum(json: string, position: number): string {
  const body = JSON.parse(json) as Record<string, unknown>;
  const checksum = body.checksum;
  if (typeof checksum !== "string" || checksum.length === 0) return json;
  const i = position % checksum.length;
  const flipped = ((parseInt(checksum[i]!, 16) || 0) + 1) % 16;
  body.checksum = checksum.slice(0, i) + flipped.toString(16) + checksum.slice(i + 1);
  return JSON.stringify(body);
}
