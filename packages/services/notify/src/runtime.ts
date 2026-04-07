import type { Envelope, Handler, ServiceDeps, Topic } from "@sudsnik/contracts";
import { err, type Result } from "@sudsnik/kernel";

/** What a handler needs from the app that owns its deps: the selected variant's ingest. */
export interface Runtime {
  ingest(envelope: Envelope): Promise<Result<void>>;
}

const runtimes = new WeakMap<ServiceDeps, Runtime>();

export function bindRuntime(deps: ServiceDeps, runtime: Runtime): void {
  runtimes.set(deps, runtime);
}

/** A handler per consumed topic; the registry scans `src/handlers/`, each file default-exports one of these. */
export function handlerFor(topic: Topic): Handler {
  return {
    topic,
    async handle(envelope, deps) {
      const rt = runtimes.get(deps);
      if (!rt) return err({ code: "INTERNAL", message: `notify has no runtime bound for ${topic}`, retryable: true });
      return rt.ingest(envelope);
    },
  };
}
