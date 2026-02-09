import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { EnvelopeSchema, isTopic, mayConsume, type Handler, type ServiceDeps } from "@sudsnik/contracts";
import { err, type Result, type Stop } from "@sudsnik/kernel";

export interface RegisteredHandler {
  file: string;
  topic: string;
  stop: Stop;
}

/**
 * Scans `deps.handlersDir` for files whose default export is a Handler and subscribes each with consumer = service.
 * A handler on a topic the service does not declare is refused.
 */
export async function registerHandlers(deps: ServiceDeps, dir = deps.handlersDir): Promise<RegisteredHandler[]> {
  const files = readdirSync(dir)
    .filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"))
    .sort();
  const out: RegisteredHandler[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)) as { default?: unknown };
    const h = mod.default as Partial<Handler> | undefined;
    if (!h || typeof h.handle !== "function" || typeof h.topic !== "string") throw new TypeError(`${file}: default export is not a Handler`);
    if (!isTopic(h.topic)) throw new TypeError(`${file}: unknown topic ${h.topic}`);
    if (!mayConsume(deps.service, h.topic)) throw new TypeError(`${file}: ${deps.service} does not consume ${h.topic}`);
    const handler = h as Handler;
    const stop = deps.bus.subscribe(
      handler.topic,
      async (envelope): Promise<Result<void>> => {
        const parsed = EnvelopeSchema.safeParse(envelope);
        if (!parsed.success) return err({ code: "INVALID", message: `bad envelope: ${parsed.error.message}`, retryable: false });
        return handler.handle(envelope, deps);
      },
      { consumer: deps.service },
    );
    out.push({ file, topic: handler.topic, stop });
  }
  return out;
}
