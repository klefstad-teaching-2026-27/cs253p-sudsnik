import { CommonEnvSchema } from "../../env.js";
export const OrdersEnvSchema = CommonEnvSchema;
export type OrdersEnv = typeof OrdersEnvSchema._output;
