import type { ServiceDeps } from "@sudsnik/contracts";
import { createOutbox, registerHandlers } from "@sudsnik/infra-queue";
import { announceOperators } from "../../announce.js";
import { baseApp } from "../../app.js";
import { openAccountsDb } from "../../db.js";
import { registerRoutes } from "../../routes/index.js";
import { naiveService } from "./service.js";

export const variant = "naive";

export async function createApp(deps: ServiceDeps) {
  const app = await baseApp(deps, variant);
  const db = openAccountsDb(deps);
  const outbox = createOutbox(db, deps.bus);
  registerRoutes(app, naiveService(deps, db, outbox));
  // Stops run in reverse: the outbox pumps its last rows before the db closes.
  app.sudsnik.registerStop(() => db.close());
  app.sudsnik.registerStop(() => outbox.stop());
  for (const h of await registerHandlers(deps)) app.sudsnik.registerStop(h.stop);
  await announceOperators(deps, db, outbox);
  // The timer starts only after the announcement is published: a pump coalesces onto an in-flight one that read its
  // batch before the announcement was enqueued, which would report ready with the announcement still unpublished.
  outbox.start();
  app.sudsnik.setReady(true);
  return app;
}
