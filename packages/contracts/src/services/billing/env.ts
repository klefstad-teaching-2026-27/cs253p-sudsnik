import { CommonEnvSchema } from "../../env.js";
export const BillingEnvSchema = CommonEnvSchema;
export type BillingEnv = typeof BillingEnvSchema._output;
