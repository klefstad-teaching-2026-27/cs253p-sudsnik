import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeMeter } from "@sudsnik/contracts/testing";
import { classify, openDb } from "../src/index.js";

describe("db", () => {
  it("applies migrations once, meters statements by verb, and prices lazy writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "sudsnik-db-"));
    const mig = join(dir, "migrations");
    mkdirSync(mig);
    writeFileSync(join(mig, "0001_init.sql"), "create table t (id integer primary key, v text);");
    const meter = new FakeMeter();
    const db = openDb({ path: join(dir, "x.sqlite"), service: "t", meter, migrationsDir: mig });
    expect(db.migrate(mig)).toEqual([]);
    db.write("insert into t (v) values (?)", "a");
    db.lazy(() => db.write("insert into t (v) values (?)", "b"));
    expect(db.read<{ v: string }>("select v from t order by id").map((r) => r.v)).toEqual(["a", "b"]);
    expect(db.readOne<{ n: number }>("select count(*) as n from t")?.n).toBe(2);
    expect(meter.byOperation.CONNECTION?.count).toBe(1);
    expect(meter.byOperation.DB_WRITE?.count).toBe(1);
    expect(meter.byOperation.DB_LAZY_WRITE?.count).toBe(1);
    expect(meter.byOperation.DB_READ?.count).toBe(2);
    expect(db.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
  });
  it("classifies SQL", () => {
    expect(classify("SELECT 1", false)).toBe("DB_READ");
    expect(classify(" with x as (select 1) select * from x", true)).toBe("DB_READ");
    expect(classify("update t set v=1", true)).toBe("DB_LAZY_WRITE");
    expect(classify("delete from t", false)).toBe("DB_WRITE");
  });
  it("transactions roll back on throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "sudsnik-db-"));
    const db = openDb({ path: join(dir, "y.sqlite"), service: "t", meter: new FakeMeter() });
    db.sqlite.exec("create table t (id integer primary key)");
    expect(() => db.transaction(() => { db.write("insert into t default values"); throw new Error("boom"); })).toThrow("boom");
    expect(db.readOne<{ n: number }>("select count(*) as n from t")?.n).toBe(0);
  });
});
