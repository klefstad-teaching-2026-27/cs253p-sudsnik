import { NotifyEnvSchema, type NotifyEnv } from "@sudsnik/contracts/services/notify";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

export function readEnv(): Result<NotifyEnv> {
  return readEnvWith(NotifyEnvSchema);
}
