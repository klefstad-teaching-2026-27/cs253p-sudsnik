import { GatewayEnvSchema, type GatewayEnv } from "@sudsnik/contracts/services/gateway";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

export const readEnv = (): Result<GatewayEnv> => readEnvWith(GatewayEnvSchema);
