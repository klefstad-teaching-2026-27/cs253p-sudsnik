import type { Bus, Envelope } from "@sudsnik/contracts";
import type { Db } from "@sudsnik/infra-db";

export const OUTBOX_SCHEMA = `
create table if not exists outbox (
  seq integer primary key autoincrement,
  id text not null unique,
  topic text not null,
  tenant_id text not null,
  occurred_at integer not null,
  correlation_id text not null,
  causation_id text not null,
  payload text not null,
  published integer not null default 0
);
create index if not exists outbox_unpublished on outbox (published, seq);
`;

export interface Outbox {
  /** Call inside the same transaction as the state change the event describes. */
  enqueue(envelope: Envelope): void;
  /** Publishes unpublished rows in order; returns how many. */
  pump(): Promise<number>;
  start(pollMs?: number): void;
  stop(): Promise<void>;
  pending(): number;
}

/** Transactional outbox: rows are written with the service's own state and moved to the bus by the pump. */
export function createOutbox(db: Db, bus: Bus): Outbox {
  db.sqlite.exec(OUTBOX_SCHEMA);
  const insert = db.sqlite.prepare(
    "insert or ignore into outbox (id, topic, tenant_id, occurred_at, correlation_id, causation_id, payload) values (?, ?, ?, ?, ?, ?, ?)",
  );
  const UNPUBLISHED = "select * from outbox where published = 0 order by seq limit 100";
  const mark = db.sqlite.prepare("update outbox set published = 1 where id = ?");
  let timer: NodeJS.Timeout | undefined;
  let pumping: Promise<number> | undefined;

  async function pump(): Promise<number> {
    if (pumping) return pumping;
    pumping = (async () => {
      const rows = db.lazy(() => db.read<{ id: string; topic: string; tenant_id: string; occurred_at: number; correlation_id: string; causation_id: string; payload: string }>(UNPUBLISHED));
      for (const r of rows) {
        await bus.publish({
          id: r.id,
          topic: r.topic as Envelope["topic"],
          tenantId: r.tenant_id,
          occurredAt: r.occurred_at,
          correlationId: r.correlation_id,
          causationId: r.causation_id,
          payload: JSON.parse(r.payload) as unknown,
        });
        db.lazy(() => mark.run(r.id));
      }
      return rows.length;
    })();
    try {
      return await pumping;
    } finally {
      pumping = undefined;
    }
  }

  return {
    enqueue(e) {
      insert.run(e.id, e.topic, e.tenantId, e.occurredAt, e.correlationId, e.causationId, JSON.stringify(e.payload ?? null));
    },
    pump,
    start(pollMs = 50) {
      if (timer) return;
      timer = setInterval(() => void pump().catch(() => undefined), pollMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (pumping) await pumping;
      await pump();
    },
    pending: () => (db.sqlite.prepare("select count(*) as n from outbox where published = 0").get() as { n: number }).n,
  };
}
