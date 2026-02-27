import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PUBLIC_SEED } from "@sudsnik/contracts";
import { fakeEnv } from "@sudsnik/contracts/testing";
import { createProcessContext, depsFor, readEnvWith } from "../src/index.js";

describe("boot", () => {
  it("builds a process context and per-service deps sharing clock, bus, and meter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sudsnik-boot-"));
    const env = fakeEnv("orders", dir, PUBLIC_SEED);
    const ctx = createProcessContext(env);
    const a = depsFor(ctx, "orders", { handlersDir: join(dir, "h") });
    const b = depsFor(ctx, "billing", { handlersDir: join(dir, "h") });
    expect(a.clock).toBe(b.clock);
    a.meter.charge("DB_READ", 1, { service: "orders" });
    expect(ctx.meter.cost("orders").totalUnits).toBe(8);
    expect(ctx.meter.cost("billing").totalUnits).toBe(0);
    expect(a.flags.isOn("orders.enabled")).toBe(true);
    await ctx.close();
  });
  it("readEnvWith reports missing variables as INVALID", () => {
    const r = readEnvWith(z.object({ X: z.string() }), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/X/);
  });
});
