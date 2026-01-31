import { CommonEnvSchema } from "../../env.js";
export const GatewayEnvSchema = CommonEnvSchema;
export type GatewayEnv = typeof GatewayEnvSchema._output;
