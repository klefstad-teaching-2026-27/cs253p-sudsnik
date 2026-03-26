import { bootService } from "@sudsnik/infra-boot";
import { handlersDir } from "./core/paths.js";
import { readEnv } from "./env.js";
import { createApp } from "./variants/cancel-noop/index.js";

export { readEnv, handlersDir, createApp };
export * from "./variants/cancel-noop/index.js";

export async function start(): Promise<void> {
  await bootService({ service: "orders", readEnv, createApp, handlersDir });
}
