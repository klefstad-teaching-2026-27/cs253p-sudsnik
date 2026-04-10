import { bootService } from "@sudsnik/infra-boot";
import { readEnv } from "./env.js";
import { createApp, handlersDir } from "./variants/keywords/index.js";

export { readEnv } from "./env.js";
export { createApp, handlersDir, variant } from "./variants/keywords/index.js";
export type { SupportApp, SupportInternals } from "./app.js";
export type { SupportService, TriageWorkflow } from "./port.js";

export async function start(): Promise<void> {
  await bootService({ service: "support", readEnv, createApp, handlersDir });
}
