import { fileURLToPath } from "node:url";
import { bootService } from "@sudsnik/infra-boot";
import { createApp } from "./variants/golden/index.js";
import { readEnv } from "./env.js";

export const service = "accounts" as const;
/** Every variant consumes nothing, so all three share the empty handlers directory. */
export const handlersDir = fileURLToPath(new URL("./handlers/", import.meta.url));

export { readEnv };
export * from "./variants/golden/index.js";
export type { AccountsService } from "./port.js";

export function start(): Promise<{ port: number; close(): Promise<void> }> {
  return bootService({ service, readEnv, createApp, handlersDir });
}
