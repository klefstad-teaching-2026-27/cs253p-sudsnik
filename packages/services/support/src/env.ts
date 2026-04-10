import { SupportEnvSchema, type SupportEnv } from "@sudsnik/contracts/services/support";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

/** The service's environment (system-spec §5.3); `source` lets createApp validate `deps.env` the same way. */
export function readEnv(source?: Record<string, string | undefined>): Result<SupportEnv> {
  return readEnvWith(SupportEnvSchema, source);
}
