import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Meter, Op } from "@sudsnik/contracts";

export interface OpenDbOptions {
  path: string;
  service: string;
  meter: Meter;
  /** Directory of `NNNN_name.sql` files applied in order, once each, recorded in `_migrations`. */
  migrationsDir?: string;
}

export interface Db {
  readonly sqlite: Database.Database;
  readonly orm: BetterSQLite3Database;
  /** Runs `fn` with writes priced DB_LAZY_WRITE instead of DB_WRITE. */
  lazy<T>(fn: () => T): T;
  transaction<T>(fn: () => T): T;
  /** Prepared, metered statement helpers for services that prefer SQL to the ORM. */
  read<T = unknown>(sql: string, ...params: unknown[]): T[];
  readOne<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  write(sql: string, ...params: unknown[]): Database.RunResult;
  migrate(dir: string): string[];
  close(): void;
}

const READ_RE = /^\s*(select|with|pragma|explain)/i;

export function classify(sql: string, lazy: boolean): Op {
  if (READ_RE.test(sql)) return "DB_READ";
  return lazy ? "DB_LAZY_WRITE" : "DB_WRITE";
}

/**
 * Opens (creating if needed) one SQLite file in WAL mode and charges CONNECTION once. Every statement run through
 * the ORM or the helpers is priced by its verb; a statement inside `lazy()` is priced DB_LAZY_WRITE.
 */
export function openDb(opts: OpenDbOptions): Db {
  mkdirSync(dirname(opts.path), { recursive: true });
  const sqlite = new Database(opts.path);
  // Before `journal_mode`: see `infra/queue/src/bus.ts`. One file per service makes the race
  // rarer here than on the bus, not impossible.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  opts.meter.charge("CONNECTION", 1, { service: opts.service });
  let lazyDepth = 0;
  const charge = (sql: string) => opts.meter.charge(classify(sql, lazyDepth > 0), 1, { service: opts.service });
  const orm = drizzle(sqlite, { logger: { logQuery: (q) => charge(q) } });
  const db: Db = {
    sqlite,
    orm,
    lazy(fn) {
      lazyDepth++;
      try {
        return fn();
      } finally {
        lazyDepth--;
      }
    },
    transaction: (fn) => sqlite.transaction(fn)(),
    read(sql, ...params) {
      charge(sql);
      return sqlite.prepare(sql).all(...params) as never;
    },
    readOne(sql, ...params) {
      charge(sql);
      return sqlite.prepare(sql).get(...params) as never;
    },
    write(sql, ...params) {
      charge(sql);
      return sqlite.prepare(sql).run(...params);
    },
    migrate(dir) {
      sqlite.exec("create table if not exists _migrations (name text primary key, applied_at_wall integer not null)");
      const applied = new Set((sqlite.prepare("select name from _migrations").all() as { name: string }[]).map((r) => r.name));
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      const done: string[] = [];
      for (const f of files) {
        if (applied.has(f)) continue;
        const sql = readFileSync(join(dir, f), "utf8");
        sqlite.transaction(() => {
          sqlite.exec(sql);
          sqlite.prepare("insert into _migrations (name, applied_at_wall) values (?, ?)").run(f, Date.now());
        })();
        done.push(f);
      }
      return done;
    },
    close: () => sqlite.close(),
  };
  if (opts.migrationsDir) db.migrate(opts.migrationsDir);
  return db;
}
