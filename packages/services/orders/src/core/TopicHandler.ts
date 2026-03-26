import type { Envelope, Handler, ServiceDeps, Topic } from "@sudsnik/contracts";
import { err, sudsnikError, type Result } from "@sudsnik/kernel";
import { eventSinkFor } from "./eventSink.js";

/** A handler file names its topic; the bound service does the work. */
export class TopicHandler<T extends Topic> implements Handler {
  constructor(readonly topic: T) {}

  async handle(envelope: Envelope, deps: ServiceDeps): Promise<Result<void>> {
    const sink = eventSinkFor(deps);
    if (!sink) return err(sudsnikError("INTERNAL", `orders has no event sink bound; createApp(deps) has not run for these deps`));
    return sink.applyEvent(envelope);
  }
}
