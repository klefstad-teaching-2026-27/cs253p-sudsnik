import type { ServiceDeps } from "@sudsnik/contracts";
import type { Db } from "@sudsnik/infra-db";
import type { SupportCore } from "./service.js";
import type { Store } from "./store.js";

export interface HandlerContext {
  db: Db;
  store: Store;
  service: SupportCore;
}

/** The registry hands a handler only `deps`; createApp binds the state it built to that same object. */
const bound = new WeakMap<ServiceDeps, HandlerContext>();

export function bindHandlers(deps: ServiceDeps, ctx: HandlerContext): void {
  bound.set(deps, ctx);
}

export function handlerContext(deps: ServiceDeps): HandlerContext {
  const ctx = bound.get(deps);
  if (!ctx) throw new Error("support handlers ran before createApp bound their context");
  return ctx;
}
