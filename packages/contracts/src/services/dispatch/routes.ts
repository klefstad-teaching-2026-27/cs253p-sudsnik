import { z } from "zod";
import { IdSchema, SimMsSchema } from "../../common.js";
import { RelayCallback } from "../../mocks/relay.js";

export const Assignment = z.object({
  orderId: IdSchema,
  tenantId: IdSchema,
  leg: z.enum(["pickup", "return"]),
  shuttleId: IdSchema,
  nodeId: IdSchema,
  holdId: IdSchema.optional(),
  windowStart: SimMsSchema,
  windowEnd: SimMsSchema,
  state: z.enum(["scheduled", "underway", "done", "cancelled"]),
});
export type Assignment = z.infer<typeof Assignment>;

export const routes = {
  schedulePickup: { method: "POST", path: "/assignments/pickup", body: z.object({ orderId: IdSchema }), response: Assignment, idempotent: true },
  scheduleReturn: { method: "POST", path: "/assignments/return", body: z.object({ orderId: IdSchema }), response: Assignment, idempotent: true },
  reassign: { method: "POST", path: "/assignments/:orderId/reassign", response: Assignment, idempotent: true },
  get: { method: "GET", path: "/assignments/:orderId", response: z.array(Assignment) },
  relayCallback: { method: "POST", path: "/callbacks/relay", body: RelayCallback, response: z.object({ accepted: z.boolean(), duplicate: z.boolean() }) },
} as const;
