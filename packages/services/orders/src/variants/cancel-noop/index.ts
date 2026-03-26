import type { ServiceDeps } from "@sudsnik/contracts";
import { composeApp } from "../../core/composeApp.js";
import { CancelNoopOrdersService } from "./CancelNoopOrdersService.js";

export const variant = "cancel-noop";

export function createApp(deps: ServiceDeps) {
  return composeApp(deps, { variant, service: (parts) => new CancelNoopOrdersService(parts.repo, parts.outbox, parts.deps) });
}
