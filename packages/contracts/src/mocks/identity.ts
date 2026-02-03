import { z } from "zod";
import { IdSchema, SimMsSchema } from "../common.js";

export const TokenRequest = z.object({ operatorId: IdSchema, key: z.string().min(1) });
export const TokenResponse = z.object({ token: z.string(), operatorId: IdSchema, expiresAtMs: SimMsSchema });
export const VerifyResponse = z.object({ operatorId: IdSchema, scopes: z.array(z.string()) });
export type TokenResponse = z.infer<typeof TokenResponse>;
export type VerifyResponse = z.infer<typeof VerifyResponse>;
