import type { ServiceDeps } from "@sudsnik/contracts";
import { bootService } from "@sudsnik/infra-boot";
import { createServiceApp, handlersDir, type NotifyApp, type VariantRuntime, type Wiring } from "../../app.js";
import { markDelivered, send, type DeliveryState } from "../../delivery/relay.js";
import { readEnv } from "../../env.js";
import { next, pipeline, stage } from "../../pipeline.js";
import { parse, persist, render, resolve, type IngestState } from "../../queue/ingest.js";
import { ingestWith, observer, port } from "../../service.js";

export const variant = "exactly-once";
export { readEnv, handlersDir };

const always = () => true;
const queued = () => "queued" as const;

/** Sends once and marks the notification delivered whatever relay answered; no retry, no dedupe, no sweep. */
export function runtime(w: Wiring): VariantRuntime {
  const observe = observer(w.deps);
  const deliver = pipeline<DeliveryState>("deliver", [send(w), markDelivered(w)], observe);
  const dispatch = stage<IngestState>("dispatch", async (s) => {
    if (s.notification) await deliver({ notification: s.notification, now: s.now, attempt: 0 });
    return next(s);
  });
  const ingest = pipeline<IngestState>("ingest", [parse(), resolve(w), render(), persist(w, { first: () => true, initialState: queued }), dispatch], observe);
  const api = port({ w, deliver, initialState: queued, dispatchOnWrite: always });
  return {
    ingest: (envelope) => ingestWith(ingest, w.deps, envelope),
    send: api.send,
    digest: api.digest,
    sweep: () => Promise.resolve(),
    stop: () => undefined,
  };
}

export function createApp(deps: ServiceDeps): Promise<NotifyApp> {
  return createServiceApp(deps, { variant, runtime });
}

export function start(): Promise<unknown> {
  return bootService({ service: "notify", readEnv, createApp, handlersDir });
}
