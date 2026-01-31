import { z } from "zod";
import { IdSchema, SimMsSchema } from "../../common.js";
import { WasherCallback } from "../../mocks/washer-v2.js";

export const HoldState = z.enum(["held", "consumed", "released", "expired"]);
export const Hold = z.object({
  holdId: IdSchema,
  tenantId: IdSchema,
  nodeId: IdSchema,
  washerId: IdSchema,
  orderId: IdSchema,
  state: HoldState,
  acquiredAt: SimMsSchema,
  expiresAt: SimMsSchema,
  version: z.number().int().nonnegative(),
  firmwareRef: z.string().optional(),
});
export type Hold = z.infer<typeof Hold>;

export const Washer = z.object({
  washerId: IdSchema,
  nodeId: IdSchema,
  firmware: z.enum(["v1", "v2"]),
  state: z.enum(["idle", "held", "washing", "faulted", "maintenance"]),
  holdId: IdSchema.optional(),
});
export const NodeStatus = z.object({ nodeId: IdSchema, inContact: z.boolean(), washers: z.array(Washer) });
export type NodeStatus = z.infer<typeof NodeStatus>;

export const routes = {
  acquireHold: { method: "POST", path: "/holds", body: z.object({ nodeId: IdSchema, orderId: IdSchema }), response: Hold, idempotent: true },
  releaseHold: { method: "POST", path: "/holds/:holdId/release", body: z.object({ reason: z.string() }), response: Hold, idempotent: true },
  startCycle: { method: "POST", path: "/holds/:holdId/start", response: z.object({ cycleId: IdSchema, washerId: IdSchema, startedAt: SimMsSchema }), idempotent: true },
  status: { method: "GET", path: "/nodes/:nodeId", response: NodeStatus },
  washerCallback: { method: "POST", path: "/callbacks/washer", body: WasherCallback, response: z.object({ accepted: z.boolean(), duplicate: z.boolean() }) },
} as const;
