import { bootService } from "@sudsnik/infra-boot";
import { readEnv } from "./env.js";
import { handlersDir } from "./paths.js";
import { createApp } from "./variants/v1-only/index.js";

export { readEnv } from "./env.js";
export { handlersDir } from "./paths.js";
export type { GatewayRoutes } from "./port.js";
export * from "./variants/v1-only/index.js";

/** The selector is the only file that names a variant (`docs/system-spec.md` §8), so `start` belongs beside it. */
export const start = async (): Promise<void> => {
  await bootService({ service: "gateway", readEnv, createApp, handlersDir });
};
