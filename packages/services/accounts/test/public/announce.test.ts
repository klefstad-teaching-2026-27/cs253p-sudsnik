import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeEnvelope } from "@sudsnik/contracts";
import { OPERATORS } from "@sudsnik/contracts/canon";
import type { OperatorUpdated } from "@sudsnik/contracts/events";
import { fakeDeps, type FakeDeps } from "@sudsnik/contracts/testing";
import { createOutbox } from "@sudsnik/infra-queue";
import { openAccountsDb } from "../../src/db.js";
import { handlersDir } from "../../src/index.js";
import { SEED, boot, createHollowApp, variants, type TestApp } from "../helpers.js";

/** The outbox's own default poll interval (`infra/queue/src/outbox.ts`), which the test drives by hand. */
const OUTBOX_POLL_MS = 50;

/** Set by the test that needs to observe the moment readiness is reported; see the createBaseApp wrapper below. */
let onReady: (() => void) | undefined;

vi.mock("@sudsnik/infra-http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sudsnik/infra-http")>();
  return {
    ...actual,
    createBaseApp: async (opts: Parameters<typeof actual.createBaseApp>[0]) => {
      const app = await actual.createBaseApp(opts);
      const setReady = app.sudsnik.setReady.bind(app.sudsnik);
      app.sudsnik.setReady = (ready: boolean) => {
        if (ready) onReady?.();
        setReady(ready);
      };
      return app;
    },
  };
});

const SEEDED: Record<string, OperatorUpdated> = {
  op1: { operatorId: "op1", pricingTier: "standard", region: "us", currency: "USD" },
  op2: { operatorId: "op2", pricingTier: "priority", region: "eu", currency: "EUR" },
  op3: { operatorId: "op3", pricingTier: "standard", region: "apac", currency: "AUD" },
  op4: { operatorId: "op4", pricingTier: "priority", region: "us", currency: "USD" },
};

/** Deps whose data directory a previous boot left holding one announcement it enqueued and never published. */
function depsAfterAnUnpublishedBoot() {
  const deps = fakeDeps(SEED, "accounts", { handlersDir });
  const stale = makeEnvelope({ topic: "operator.updated", tenantId: "op1", occurredAt: 1, payload: SEEDED.op1 });
  const db = openAccountsDb(deps);
  createOutbox(db, deps.bus).enqueue(stale);
  db.close();
  return { deps, stale };
}

const announcements = (deps: FakeDeps) => deps.bus.ofTopic<OperatorUpdated>("operator.updated");
const byOperator = (deps: FakeDeps, from = 0) => Object.fromEntries(announcements(deps).slice(from).map((e) => [e.payload.operatorId, e.payload]));

for (const [name, create] of Object.entries(variants)) {
  describe(`${name} startup announcement`, () => {
    let app: TestApp;
    let deps: FakeDeps;
    beforeAll(async () => ({ app, deps } = await boot(create)));
    afterAll(() => app.sudsnik.drain());

    it("announces every seeded operator with its tier, region, and currency", () => {
      expect(announcements(deps).length).toBe(OPERATORS.length);
      expect(byOperator(deps)).toEqual(SEEDED);
      for (const e of announcements(deps)) expect(e.tenantId).toBe(e.payload.operatorId);
    });

    it("publishes the announcement before it reports ready", async () => {
      const booting = fakeDeps(SEED, "accounts", { handlersDir });
      let announcedAtReady = -1;
      onReady = () => (announcedAtReady = announcements(booting).length);
      const booted = await create(booting);
      onReady = undefined;
      expect(announcedAtReady).toBe(OPERATORS.length);
      expect(booted.sudsnik.isReady()).toBe(true);
      await booted.sudsnik.drain();
    });

    it("publishes the announcement before it reports ready on a restart that finds unpublished rows", async () => {
      const { deps: restarting, stale } = depsAfterAnUnpublishedBoot();
      const now = restarting.clock.now.bind(restarting.clock);
      let announcedAtReady = -1;
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      // Boot never yields to the event loop on its own, so the outbox poll runs only when this test lets it: every
      // clock read offers it the interval, including the read announceOperators takes before enqueueing its rows.
      restarting.clock.now = () => {
        vi.advanceTimersByTime(OUTBOX_POLL_MS);
        return now();
      };
      onReady = () => (announcedAtReady = announcements(restarting).length);
      try {
        const booted = await create(restarting);
        restarting.clock.now = now;
        expect(announcedAtReady).toBe(OPERATORS.length + 1);
        expect(announcements(restarting)[0]!.id).toBe(stale.id);
        expect(byOperator(restarting, 1)).toEqual(SEEDED);
        await booted.sudsnik.drain();
      } finally {
        onReady = undefined;
        restarting.clock.now = now;
        vi.useRealTimers();
      }
    });

    it("reports ready when the publish fails, leaving the announcement for the outbox to retry", async () => {
      const offline = fakeDeps(SEED, "accounts", { handlersDir });
      const publish = offline.bus.publish.bind(offline.bus);
      offline.bus.publish = () => Promise.reject(new Error("no consumer yet"));
      const booted = await create(offline);
      expect(booted.sudsnik.isReady()).toBe(true);
      expect(announcements(offline).length).toBe(0);

      offline.bus.publish = publish;
      await booted.sudsnik.drain();
      expect(byOperator(offline)).toEqual(SEEDED);
    });

    it("announces again with fresh envelope ids after a restart, carrying the same values", async () => {
      const restarting = fakeDeps(SEED, "accounts", { handlersDir });
      const first = await create(restarting);
      const firstIds = announcements(restarting).map((e) => e.id);
      await first.sudsnik.drain();

      const second = await create(restarting);
      expect(byOperator(restarting, firstIds.length)).toEqual(SEEDED);
      expect(announcements(restarting).slice(firstIds.length).some((e) => firstIds.includes(e.id))).toBe(false);
      await second.sudsnik.drain();
    });
  });
}

describe("hollow startup announcement", () => {
  it("announces nothing", async () => {
    const { app, deps } = await boot(createHollowApp);
    expect(deps.bus.published.length).toBe(0);
    await app.sudsnik.drain();
  });
});
