import { DispatchEnvSchema, type DispatchEnv } from "@sudsnik/contracts/services/dispatch";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

/** The service's configuration, validated by zod; `createApp` reads `deps.env` through it, `start()` the process environment. */
export function readEnv(source: Record<string, string | undefined> = process.env): Result<DispatchEnv> {
  return readEnvWith(DispatchEnvSchema, source);
}
