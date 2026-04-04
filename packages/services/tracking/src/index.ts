import { fileURLToPath } from "node:url";
import { TrackingEnvSchema } from "@sudsnik/contracts/services/tracking";
import { bootService, readEnvWith } from "@sudsnik/infra-boot";
import { createApp } from "./variants/naive/index.js";

export * from "./variants/naive/index.js";
export type { TrackingService } from "./port.js";

export const handlersDir = fileURLToPath(new URL("./handlers/", import.meta.url));
export const readEnv = () => readEnvWith(TrackingEnvSchema);
export async function start(): Promise<void> {
  await bootService({ service: "tracking", readEnv, createApp, handlersDir });
}
