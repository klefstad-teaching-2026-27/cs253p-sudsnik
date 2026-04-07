import type { Ctx, Envelope, ServiceDeps } from "@sudsnik/contracts";
import type { Digest, Notification, SendNotification } from "@sudsnik/contracts/services/notify";
import { err, newId, ok, type Result } from "@sudsnik/kernel";
import type { Wiring } from "./app.js";
import { inLinkWindow, isKnownHabitat, nextWindow } from "./delivery/window.js";
import { stillPending, type DeliveryState } from "./delivery/relay.js";
import type { Outcome, Pipeline, StageEvent } from "./pipeline.js";
import type { IngestState } from "./queue/ingest.js";
import { toNotification, type NotificationState } from "./queue/store.js";
import { render } from "./templates/index.js";

/** Halts and failures are logged; a stage that carried on is not. */
export function observer(deps: ServiceDeps): (e: StageEvent) => void {
  return (e) => {
    if (e.kind === "halt") deps.telemetry.logger.info("stage_halted", { pipeline: e.pipeline, stage: e.stage, reason: e.detail });
    else if (e.kind === "fail") deps.telemetry.logger.warn("stage_failed", { pipeline: e.pipeline, stage: e.stage, error: e.detail });
  };
}

export function toResult(o: Outcome<unknown>): Result<void> {
  return o.kind === "fail" ? err(o.error) : ok(undefined);
}

export interface PortOptions {
  w: Wiring;
  deliver: Pipeline<DeliveryState>;
  initialState(habitatId: string, now: number): NotificationState;
  /** Attempt delivery as soon as the notification is written. */
  dispatchOnWrite(habitatId: string, now: number): boolean;
  /** Called when a notification is left undelivered for the sweep. */
  onPending?(): void;
}

/** `send` and `digest` over the store, shared by every variant that keeps state. */
export function port(o: PortOptions): { send(n: SendNotification, ctx: Ctx): Promise<Result<Notification>>; digest(habitatId: string, ctx: Ctx): Promise<Result<Digest>> } {
  const { store, deps } = o.w;
  return {
    async send(n, ctx) {
      if (!isKnownHabitat(n.habitatId)) return err({ code: "INVALID", message: `unknown habitat ${n.habitatId}`, retryable: false });
      const now = deps.clock.now();
      const notificationId = newId();
      const rendered = render(n.template, n.params);
      store.insertNotification({ notificationId, tenantId: ctx.tenantId, habitatId: n.habitatId, ...(n.orderId === undefined ? {} : { orderId: n.orderId }), channel: n.channel, template: n.template, params: n.params, title: rendered.title, body: rendered.body, correlationId: ctx.correlationId, createdAt: now, state: o.initialState(n.habitatId, now) });
      deps.telemetry.counter("notify.ingested").add(1);
      let row = store.notification(notificationId);
      if (!row) return err({ code: "INTERNAL", message: "notification vanished after insert", retryable: true });
      if (o.dispatchOnWrite(n.habitatId, now)) {
        const outcome = await o.deliver({ notification: row, now, attempt: 0 });
        if (outcome.kind === "next") row = outcome.state.notification;
      }
      if (row.state !== "delivered") o.onPending?.();
      return ok(toNotification(row));
    },
    async digest(habitatId, ctx) {
      if (!isKnownHabitat(habitatId)) return err({ code: "INVALID", message: `unknown habitat ${habitatId}`, retryable: false });
      const now = deps.clock.now();
      return ok({ habitatId, pending: store.pending(ctx.tenantId, habitatId).map(toNotification), nextWindowAt: nextWindow(habitatId, now) });
    },
  };
}

export interface SweepOptions {
  w: Wiring;
  deliver: Pipeline<DeliveryState>;
}

/** One pass over due notifications, at most one in flight; skips the read while nothing is known to be pending. */
export function sweeper(o: SweepOptions): { sweep(): Promise<void>; notePending(): void } {
  const { store, deps } = o.w;
  let inFlight: Promise<void> | undefined;
  let maybePending = store.pendingCount() > 0;
  async function pass(): Promise<void> {
    if (!maybePending) return;
    const now = deps.clock.now();
    let pending = false;
    for (const row of store.undelivered()) {
      const outcome = await o.deliver({ notification: row, now, attempt: 0 });
      if (stillPending(outcome)) pending = true;
    }
    maybePending = pending;
  }
  return {
    sweep() {
      if (inFlight) return inFlight;
      inFlight = pass().finally(() => (inFlight = undefined));
      return inFlight;
    },
    notePending: () => void (maybePending = true),
  };
}

export async function ingestWith(ingest: Pipeline<IngestState>, deps: ServiceDeps, envelope: Envelope): Promise<Result<void>> {
  return toResult(await ingest({ envelope, now: deps.clock.now() }));
}

