import { z } from "zod";
import { IdSchema, OrbitPhaseSchema, SimMsSchema } from "../common.js";

export const Endpoint = z.object({ kind: z.enum(["habitat", "node", "shuttle", "ground"]), id: IdSchema });
export type Endpoint = z.infer<typeof Endpoint>;

export const DeliverRequest = z.object({
  origin: Endpoint,
  destination: Endpoint,
  to: z.string(),
  path: z.string().startsWith("/"),
  body: z.record(z.string(), z.unknown()),
  deliverAtMs: SimMsSchema,
});
export type DeliverRequest = z.infer<typeof DeliverRequest>;
export const DeliverResponse = z.object({ accepted: z.literal(true), deliveryId: IdSchema });

/** Bodies the simulator sends through relay to POST /callbacks/relay on dispatch and tracking. */
const base = { id: IdSchema, atMs: SimMsSchema, checksum: z.string().length(8) };
export const RelayCallback = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("collected"), orderId: IdSchema, podId: IdSchema, shuttleId: IdSchema, ...base }),
  z.object({ kind: z.literal("delivered"), orderId: IdSchema, podId: IdSchema, shuttleId: IdSchema, nodeId: IdSchema, ...base }),
  z.object({ kind: z.literal("returned"), orderId: IdSchema, podId: IdSchema, shuttleId: IdSchema, ...base }),
  z.object({ kind: z.literal("position"), shuttleId: IdSchema, orbitPhase: OrbitPhaseSchema, ...base }),
]);
export type RelayCallback = z.infer<typeof RelayCallback>;

/** Habitat-bound notification delivery, recorded by relay instead of forwarded. */
export const HabitatDelivery = z.object({
  deliveryId: IdSchema,
  habitatId: IdSchema,
  notificationId: IdSchema,
  deliveredAtMs: SimMsSchema,
  body: z.record(z.string(), z.unknown()),
});
export type HabitatDelivery = z.infer<typeof HabitatDelivery>;
