import { AccountsEnvSchema, type AccountsEnv } from "@sudsnik/contracts/services/accounts";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

export function readEnv(): Result<AccountsEnv> {
  return readEnvWith(AccountsEnvSchema);
}
