import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { ClockTickSchema, EnvelopeSchema, type Bus, type Envelope, type Meter, type Topic } from "@sudsnik/contracts";
import { err, ok, type Result, type SimClock, type Stop } from "@sudsnik/kernel";

export const VISIBILITY_TIMEOUT_MS = 5 * 60_000;
/** Three attempts, then the message is poison and stops being delivered. */
export const MAX_DELIVERIES = 5;
export const POLL_INTERVAL_WALL_MS = 50;
/** One cursor per consumer covers every topic it subscribes to; the cursors table keys it by this sentinel. */
const CURSOR_TOPIC = "*";

const SCHEMA = `
create table if not exists messages (
  seq integer primary key autoincrement,
  id text not null unique,
  topic text not null,
  tenant_id text not null,
  occurred_at integer not null,
  correlation_id text not null,
  causation_id text not null,
  payload text not null,
  publisher text not null,
  published_wall integer not null
);
create index if not exists messages_topic_seq on messages (topic, seq);
create table if not exists cursors (consumer text not null, topic text not null, seq integer not null, primary key (consumer, topic));
create table if not exists deliveries (
  consumer text not null,
  message_id text not null,
  topic text not null,
  seq integer not null,
  attempts integer not null default 0,
  visible_at integer not null default 0,
  state text not null default 'pending',
  last_error text,
  primary key (consumer, message_id)
);
create index if not exists deliveries_pending on deliveries (consumer, state, visible_at, seq);
create table if not exists dead_letters (
  consumer text not null,
  message_id text not null,
  topic text not null,
  attempts integer not null,
  last_error text,
  dead_at integer not null,
  primary key (consumer, message_id)
);
create table if not exists topic_use (service text not null, topic text not null, direction text not null, count integer not null default 0, primary key (service, topic, direction));
`;

interface Subscription {
  consumer: string;
  topic: Topic;
  handler: (e: Envelope) => Promise<Result<void>>;
}

interface Consumer {
  name: string;
  subs: Subscription[];
  busy: boolean;
}

interface MessageRow {
  seq: number;
  id: string;
  topic: Topic;
  tenant_id: string;
  occurred_at: number;
  correlation_id: string;
  causation_id: string;
  payload: string;
}

export interface BusConnectionOptions {
  path: string;
  clock: SimClock;
  meter: Meter;
  /** Wall-clock poll interval; infra only. */
  pollMs?: number;
}

export interface BusConnection {
  forService(service: string): Bus;
  /** Delivers due messages once; the poll loop calls it, tests call it directly. */
  poll(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
  /** Latest clock.tick seen; the connection advances `clock` to it on every poll. */
  latestTick(): { nowMs: number; orbit: number; orbitPhase: number } | undefined;
  topicUse(): Array<{ service: string; topic: string; direction: string; count: number }>;
  deadLetters(consumer?: string): Array<{ consumer: string; message_id: string; topic: string; attempts: number; last_error: string | null; dead_at: number }>;
  /** Every message on a topic in seq order; the simulator and the release driver read the stream through this. */
  readAll(topic?: Topic, afterSeq?: number): Array<Envelope & { seq: number; publisher: string }>;
  close(): void;
}

/**
 * One SQLite connection to the shared bus file. Delivery is at-least-once per consumer with a visibility timeout on
 * the simulated clock; a message is dead-lettered after MAX_DELIVERIES attempts; (consumer, message id) is the dedupe key.
 */
export function openBus(opts: BusConnectionOptions): BusConnection {
  mkdirSync(dirname(opts.path), { recursive: true });
  const db = new Database(opts.path);
  // Before `journal_mode`, not after: switching to WAL takes a brief exclusive lock, and every
  // service opens this one file at boot. Without the timeout already in effect the loser of that
  // race fails outright with SQLITE_BUSY rather than waiting the moment out.
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  const consumers = new Map<string, Consumer>();
  let timer: NodeJS.Timeout | undefined;
  let polling: Promise<number> | undefined;
  let stopped = false;
  let lastTick: { nowMs: number; orbit: number; orbitPhase: number } | undefined;

  const insert = db.prepare(
    "insert or ignore into messages (id, topic, tenant_id, occurred_at, correlation_id, causation_id, payload, publisher, published_wall) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const bumpUse = db.prepare(
    "insert into topic_use (service, topic, direction, count) values (?, ?, ?, 1) on conflict (service, topic, direction) do update set count = count + 1",
  );
  const getCursor = db.prepare("select seq from cursors where consumer = ? and topic = ?");
  const setCursor = db.prepare("insert into cursors (consumer, topic, seq) values (?, ?, ?) on conflict (consumer, topic) do update set seq = excluded.seq");
  const newSince = (topics: Topic[], cursor: number) =>
    db.prepare(`select seq, id, topic from messages where seq > ? and topic in (${topics.map(() => "?").join(",")}) order by seq`).all(cursor, ...topics) as { seq: number; id: string; topic: string }[];
  const backlogOn = (topic: Topic, cursor: number) => db.prepare("select seq, id, topic from messages where topic = ? and seq <= ? order by seq").all(topic, cursor) as { seq: number; id: string; topic: string }[];
  const enqueue = db.prepare("insert or ignore into deliveries (consumer, message_id, topic, seq, visible_at) values (?, ?, ?, ?, 0)");
  const due = db.prepare(
    "select d.message_id, d.attempts, m.seq, m.id, m.topic, m.tenant_id, m.occurred_at, m.correlation_id, m.causation_id, m.payload from deliveries d join messages m on m.id = d.message_id where d.consumer = ? and d.state = 'pending' and d.visible_at <= ? order by m.seq limit 32",
  );
  const claim = db.prepare("update deliveries set attempts = attempts + 1, visible_at = ? where consumer = ? and message_id = ? and state = 'pending'");
  const done = db.prepare("update deliveries set state = 'done' where consumer = ? and message_id = ?");
  const failed = db.prepare("update deliveries set last_error = ? where consumer = ? and message_id = ?");
  const dead = db.prepare("update deliveries set state = 'dead', last_error = ? where consumer = ? and message_id = ?");
  const deadLetter = db.prepare("insert or ignore into dead_letters (consumer, message_id, topic, attempts, last_error, dead_at) values (?, ?, ?, ?, ?, ?)");
  const latestTickStmt = db.prepare("select payload from messages where topic = 'clock.tick' order by seq desc limit 1");

  function toEnvelope(row: MessageRow): Envelope {
    return {
      id: row.id,
      topic: row.topic,
      tenantId: row.tenant_id,
      occurredAt: row.occurred_at,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      payload: JSON.parse(row.payload) as unknown,
    };
  }

  function readTick(): void {
    const row = latestTickStmt.get() as { payload: string } | undefined;
    if (!row) return;
    const tick = ClockTickSchema.safeParse(JSON.parse(row.payload));
    if (!tick.success) return;
    lastTick = tick.data;
    opts.clock.advanceTo(tick.data.nowMs);
  }

  /**
   * Delivers to one consumer in publication order across every topic it subscribes to: a consumer never sees an
   * effect before the cause that another service published first. A failed message is retried after the visibility
   * timeout while later messages continue, so one poison message cannot block the stream.
   */
  async function deliverFor(consumer: Consumer): Promise<number> {
    if (consumer.busy) return 0;
    consumer.busy = true;
    try {
      const topics = [...new Set(consumer.subs.map((x) => x.topic))];
      if (topics.length === 0) return 0;
      const cursor = (getCursor.get(consumer.name, CURSOR_TOPIC) as { seq: number } | undefined)?.seq ?? 0;
      const fresh = newSince(topics, cursor);
      if (fresh.length > 0) {
        db.transaction(() => {
          for (const m of fresh) enqueue.run(consumer.name, m.id, m.topic, m.seq);
          setCursor.run(consumer.name, CURSOR_TOPIC, fresh[fresh.length - 1]!.seq);
        })();
      }
      const now = opts.clock.now();
      const rows = due.all(consumer.name, now) as (MessageRow & { message_id: string; attempts: number })[];
      let n = 0;
      for (const row of rows) {
        if (stopped) break;
        const handlers = consumer.subs.filter((x) => x.topic === row.topic);
        if (handlers.length === 0) {
          done.run(consumer.name, row.id);
          continue;
        }
        claim.run(now + VISIBILITY_TIMEOUT_MS, consumer.name, row.id);
        const attempts = row.attempts + 1;
        bumpUse.run(consumer.name, row.topic, "consume");
        let result: Result<void> = ok(undefined);
        for (const sub of handlers) {
          try {
            const r = await sub.handler(toEnvelope(row));
            if (!r.ok) result = r;
          } catch (e) {
            result = err({ code: "INTERNAL", message: e instanceof Error ? e.message : String(e), retryable: true });
          }
        }
        n++;
        if (result.ok) {
          done.run(consumer.name, row.id);
        } else if (attempts >= MAX_DELIVERIES) {
          dead.run(result.error.message, consumer.name, row.id);
          deadLetter.run(consumer.name, row.id, row.topic, attempts, result.error.message, opts.clock.now());
        } else {
          failed.run(result.error.message, consumer.name, row.id);
        }
      }
      return n;
    } finally {
      consumer.busy = false;
    }
  }

  /** Queues the messages on `topic` that the consumer's cursor has already passed; ordering holds, since delivery is by seq. */
  function backfill(consumer: string, topic: Topic): void {
    const cursor = (getCursor.get(consumer, CURSOR_TOPIC) as { seq: number } | undefined)?.seq ?? 0;
    if (cursor === 0) return;
    const rows = backlogOn(topic, cursor);
    if (rows.length === 0) return;
    db.transaction(() => {
      for (const m of rows) enqueue.run(consumer, m.id, m.topic, m.seq);
    })();
  }

  async function poll(): Promise<number> {
    if (polling) return polling;
    polling = (async () => {
      readTick();
      let n = 0;
      for (const consumer of [...consumers.values()]) n += await deliverFor(consumer);
      return n;
    })();
    try {
      return await polling;
    } finally {
      polling = undefined;
    }
  }

  return {
    forService(service) {
      return {
        async publish(envelope) {
          const parsed = EnvelopeSchema.safeParse(envelope);
          if (!parsed.success) throw new TypeError(`invalid envelope: ${parsed.error.message}`);
          insert.run(
            envelope.id,
            envelope.topic,
            envelope.tenantId,
            envelope.occurredAt,
            envelope.correlationId,
            envelope.causationId,
            JSON.stringify(envelope.payload ?? null),
            service,
            Date.now(),
          );
          bumpUse.run(service, envelope.topic, "publish");
          opts.meter.charge("QUEUE_PUBLISH", 1, { service });
        },
        subscribe(topic, handler, o) {
          let consumer = consumers.get(o.consumer);
          if (!consumer) {
            consumer = { name: o.consumer, subs: [], busy: false };
            consumers.set(o.consumer, consumer);
          }
          const sub: Subscription = { consumer: o.consumer, topic, handler };
          const isNewTopic = !consumer.subs.some((x) => x.topic === topic);
          consumer.subs.push(sub);
          // The cursor covers the topics the consumer was subscribed to when it last advanced, so a topic added
          // afterwards would start from there and its earlier messages would never be delivered. A consumer
          // registering its handlers one at a time against a bus that already holds messages is exactly that case.
          if (isNewTopic) backfill(o.consumer, topic);
          const stop: Stop = () => {
            const i = consumer.subs.indexOf(sub);
            if (i >= 0) consumer.subs.splice(i, 1);
          };
          return stop;
        },
      };
    },
    poll,
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => void poll().catch(() => undefined), opts.pollMs ?? POLL_INTERVAL_WALL_MS);
      timer.unref();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      if (polling) await polling;
    },
    latestTick: () => lastTick,
    topicUse: () => db.prepare("select service, topic, direction, count from topic_use order by service, topic, direction").all() as never,
    deadLetters: (consumer) =>
      (consumer
        ? db.prepare("select * from dead_letters where consumer = ? order by dead_at").all(consumer)
        : db.prepare("select * from dead_letters order by dead_at").all()) as never,
    readAll(topic, afterSeq = 0) {
      const rows = (
        topic
          ? db.prepare("select * from messages where topic = ? and seq > ? order by seq").all(topic, afterSeq)
          : db.prepare("select * from messages where seq > ? order by seq").all(afterSeq)
      ) as (MessageRow & { publisher: string })[];
      return rows.map((r) => ({ ...toEnvelope(r), seq: r.seq, publisher: r.publisher }));
    },
    close() {
      if (timer) clearInterval(timer);
      db.close();
    },
  };
}

export { ok };
