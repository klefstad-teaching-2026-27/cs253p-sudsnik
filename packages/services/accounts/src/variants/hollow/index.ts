import type { ErrorBody, ServiceDeps } from "@sudsnik/contracts";
import { routes } from "@sudsnik/contracts/services/accounts";
import { registerHandlers } from "@sudsnik/infra-queue";
import { baseApp } from "../../app.js";

export const variant = "hollow";

/** Every port route answers 501, a graceful absence (`docs/system-spec.md` §8 rule 2); the base app still enforces tenant and idempotency headers. */
export async function createApp(deps: ServiceDeps) {
  const app = await baseApp(deps, variant);
  const body: ErrorBody = { code: "UNAVAILABLE", message: `${deps.service} is hollow`, retryable: true };
  for (const r of Object.values(routes)) {
    app.route({ method: r.method, url: r.path, handler: async (_req, reply) => reply.code(501).send(body) });
  }
  for (const h of await registerHandlers(deps)) app.sudsnik.registerStop(h.stop);
  app.sudsnik.setReady(true);
  return app;
}
