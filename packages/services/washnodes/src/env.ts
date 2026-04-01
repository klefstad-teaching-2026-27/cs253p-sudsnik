import { WashnodesEnvSchema } from "@sudsnik/contracts/services/washnodes";
import { readEnvWith } from "@sudsnik/infra-boot";

export const readEnv = () => readEnvWith(WashnodesEnvSchema);
