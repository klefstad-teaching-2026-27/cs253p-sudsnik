import type { Envelope, ServiceDeps } from "@sudsnik/contracts";
import type { Result } from "@sudsnik/kernel";

/** What a handler hands an envelope to; the variant's service implements it. */
export interface EventSink {
  applyEvent(envelope: Envelope): Promise<Result<void>>;
}

// Handlers are discovered by directory scan and receive only ServiceDeps, so the app binds its sink to the deps object it was built with.
const sinks = new WeakMap<ServiceDeps, EventSink>();

export function bindEventSink(deps: ServiceDeps, sink: EventSink): void {
  sinks.set(deps, sink);
}

export function eventSinkFor(deps: ServiceDeps): EventSink | undefined {
  return sinks.get(deps);
}
