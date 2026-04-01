import type { Envelope, Handler, ServiceDeps, Topic } from "@sudsnik/contracts";
import { err, ok, type Result } from "@sudsnik/kernel";
import type { z } from "zod";
import { runtimeOf, type Runtime } from "../runtime.js";

/** One idempotent handler: parse the payload, skip an envelope already handled, run, then mark it handled. */
export function handler<T extends Topic, P>(topic: T, schema: z.ZodType<P>, run: (rt: Runtime, envelope: Envelope<P>) => Promise<Result<void>>): Handler<P> {
  return {
    topic,
    async handle(envelope: Envelope<P>, deps: ServiceDeps): Promise<Result<void>> {
      const rt = runtimeOf(deps);
      if (!rt) return err({ code: "UNAVAILABLE", message: "washnodes is not running for these deps", retryable: true });
      const parsed = schema.safeParse(envelope.payload);
      if (!parsed.success) return err({ code: "INVALID", message: `bad ${topic} payload: ${parsed.error.message}`, retryable: false });
      if (rt.events.seen(envelope.id)) return ok(undefined);
      const r = await run(rt, { ...envelope, payload: parsed.data });
      if (r.ok) rt.events.mark(envelope.id, deps.clock.now());
      return r;
    },
  };
}
