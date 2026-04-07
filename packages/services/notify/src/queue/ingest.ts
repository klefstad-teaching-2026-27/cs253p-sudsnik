import { payloadSchemas, type Envelope, type ServiceDeps } from "@sudsnik/contracts";
import { newId } from "@sudsnik/kernel";
import { isKnownHabitat } from "../delivery/window.js";
import { fail, halt, next, stage, type Outcome, type Stage } from "../pipeline.js";
import { stringParams, templateFor, type Params, type Rendered } from "../templates/index.js";
import type { NotificationRow, NotificationState, Store } from "./store.js";

export interface IngestState {
  envelope: Envelope;
  now: number;
  params?: Params;
  orderId?: string;
  habitatId?: string;
  template?: string;
  channel?: string;
  rendered?: Rendered;
  notification?: NotificationRow;
}

export interface IngestContext {
  deps: ServiceDeps;
  store: Store;
}

export function parse(): Stage<IngestState> {
  return stage("parse", (s) => {
    const r = payloadSchemas[s.envelope.topic].safeParse(s.envelope.payload);
    if (!r.success) return fail({ code: "INVALID", message: `${s.envelope.topic} payload: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, retryable: false });
    const parsed = r.data as Record<string, unknown>;
    const orderId = typeof parsed.orderId === "string" ? parsed.orderId : undefined;
    return next({ ...s, params: stringParams(parsed), ...(orderId === undefined ? {} : { orderId }) });
  });
}

/**
 * Finds the habitat: an event that names one (`order.placed`, `pickup.scheduled`, `return.scheduled`)
 * is taken at its word; the rest are looked up from the orders table, falling back to the habitat a
 * pod id embeds (`habNN-pNNN`) when the event carries one.
 */
export function resolve(ctx: IngestContext): Stage<IngestState> {
  const unaddressable = (reason: string): Outcome<IngestState> => {
    ctx.deps.telemetry.counter("notify.unaddressable").add(1);
    return halt(reason);
  };
  return stage("resolve", (s) => {
    const { envelope: e, orderId } = s;
    if (orderId === undefined) return unaddressable(`${e.topic} names no order`);
    const habitatId = s.params?.habitatId ?? ctx.store.habitatOfOrder(e.tenantId, orderId) ?? habitatOfPod(s.params?.podId);
    if (habitatId === undefined) return fail({ code: "UNAVAILABLE", message: `order ${orderId} not yet known`, retryable: true });
    if (!isKnownHabitat(habitatId)) return unaddressable(`unknown habitat ${habitatId}`);
    return next({ ...s, habitatId });
  });
}

function habitatOfPod(podId: string | undefined): string | undefined {
  const habitatId = podId?.split("-p")[0];
  return habitatId !== undefined && isKnownHabitat(habitatId) ? habitatId : undefined;
}

export function render(): Stage<IngestState> {
  return stage("render", (s) => {
    const t = templateFor(s.envelope.topic);
    if (!t) return fail({ code: "INTERNAL", message: `no template for ${s.envelope.topic}`, retryable: false });
    return next({ ...s, template: s.envelope.topic, channel: t.channel, rendered: t.render(s.params ?? {}) });
  });
}

export interface PersistOptions {
  /**
   * Whether this envelope is the first of its id, inside the write transaction. A variant that believes the bus
   * delivers once has nothing to record and answers yes (`docs/system-spec.md` §5.5: delivery is at-least-once).
   */
  first(ctx: IngestContext, envelopeId: string, tenantId: string, notificationId: string, now: number): boolean;
  /** `queued` awaits an attempt now; `digested` is held for the habitat's next window. */
  initialState(habitatId: string, now: number): NotificationState;
}

/** One transaction: the dedupe mark, the orders lookup row when the event named its habitat, and the notification. */
export function persist(ctx: IngestContext, opts: PersistOptions): Stage<IngestState> {
  return stage("persist", (s) => {
    const { envelope: e, habitatId, orderId, rendered, template, channel, params, now } = s;
    if (habitatId === undefined || rendered === undefined || template === undefined || channel === undefined) return fail({ code: "INTERNAL", message: "persist before resolve and render", retryable: false });
    const notificationId = newId();
    const duplicate = ctx.store.transaction(() => {
      if (!opts.first(ctx, e.id, e.tenantId, notificationId, now)) return true;
      if (orderId !== undefined && params?.habitatId !== undefined) ctx.store.rememberOrder(e.tenantId, orderId, habitatId);
      ctx.store.insertNotification({ notificationId, tenantId: e.tenantId, habitatId, orderId, channel, template, params: params ?? {}, title: rendered.title, body: rendered.body, correlationId: e.correlationId, createdAt: now, state: opts.initialState(habitatId, now) });
      return false;
    });
    if (duplicate) {
      ctx.deps.telemetry.counter("notify.duplicates").add(1);
      return halt(`duplicate envelope ${e.id}`);
    }
    ctx.deps.telemetry.counter("notify.ingested").add(1);
    const notification = ctx.store.notification(notificationId);
    return notification ? next({ ...s, notification }) : fail({ code: "INTERNAL", message: "notification vanished after insert", retryable: true });
  });
}
