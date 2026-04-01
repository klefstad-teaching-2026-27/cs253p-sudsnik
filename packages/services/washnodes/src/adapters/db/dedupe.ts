import { eq } from "drizzle-orm";
import type { Db } from "@sudsnik/infra-db";
import type { Dedupe } from "../../ports/dedupe.js";
import { handledEvents, washerCallbacks } from "./schema.js";

export function eventDedupe(db: Db): Dedupe {
  return {
    seen: (id) => db.orm.select({ id: handledEvents.eventId }).from(handledEvents).where(eq(handledEvents.eventId, id)).get() !== undefined,
    mark: (id, nowMs) => void db.orm.insert(handledEvents).values({ eventId: id, handledAt: nowMs }).onConflictDoNothing().run(),
  };
}

export function callbackDedupe(db: Db): Dedupe {
  return {
    seen: (id) => db.orm.select({ id: washerCallbacks.callbackId }).from(washerCallbacks).where(eq(washerCallbacks.callbackId, id)).get() !== undefined,
    mark: (id, nowMs) => void db.orm.insert(washerCallbacks).values({ callbackId: id, receivedAt: nowMs }).onConflictDoNothing().run(),
  };
}
