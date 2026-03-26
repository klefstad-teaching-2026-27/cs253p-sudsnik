import { OrdersEnvSchema, type OrdersEnv } from "@sudsnik/contracts/services/orders";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

export function readEnv(): Result<OrdersEnv> {
  return readEnvWith(OrdersEnvSchema);
}
