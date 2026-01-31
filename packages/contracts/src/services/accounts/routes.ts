import { z } from "zod";
import { CURRENCIES } from "../../canon.js";
import { IdSchema } from "../../common.js";

export const PricingTier = z.enum(["standard", "priority"]);
export const Region = z.enum(["us", "eu", "apac"]);
export const Operator = z.object({ operatorId: IdSchema, name: z.string(), pricingTier: PricingTier, region: Region, currency: z.enum(CURRENCIES) });
export type Operator = z.infer<typeof Operator>;
export const OperatorPatch = Operator.pick({ name: true, pricingTier: true, region: true }).partial().strict();
export type OperatorPatch = z.infer<typeof OperatorPatch>;
export const Habitat = z.object({ habitatId: IdSchema, operatorId: IdSchema, index: z.number().int().nonnegative(), name: z.string() });
export type Habitat = z.infer<typeof Habitat>;
export const Crew = z.object({ crewId: IdSchema, habitatId: IdSchema, name: z.string(), preferences: z.record(z.string(), z.string()) });
export type Crew = z.infer<typeof Crew>;

export const routes = {
  operator: { method: "GET", path: "/operators/:operatorId", response: Operator },
  updateOperator: { method: "PUT", path: "/operators/:operatorId", body: OperatorPatch, response: Operator, idempotent: true },
  habitat: { method: "GET", path: "/habitats/:habitatId", response: Habitat },
  crew: { method: "GET", path: "/habitats/:habitatId/crew", response: z.array(Crew) },
} as const;
