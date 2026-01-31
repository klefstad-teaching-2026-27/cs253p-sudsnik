import { z } from "zod";
import { IdSchema, SimMsSchema } from "../../common.js";

export const Channel = z.enum(["pod-display", "habitat-console"]);
export const SendNotification = z.object({
  habitatId: IdSchema,
  orderId: IdSchema.optional(),
  channel: Channel,
  template: z.string().min(1),
  params: z.record(z.string(), z.string()),
});
export type SendNotification = z.infer<typeof SendNotification>;
export const Notification = SendNotification.extend({
  notificationId: IdSchema,
  tenantId: IdSchema,
  state: z.enum(["queued", "delivered", "digested", "failed"]),
  createdAt: SimMsSchema,
  deliveredAt: SimMsSchema.optional(),
});
export type Notification = z.infer<typeof Notification>;
export const Digest = z.object({ habitatId: IdSchema, pending: z.array(Notification), nextWindowAt: SimMsSchema });
export type Digest = z.infer<typeof Digest>;

export const routes = {
  send: { method: "POST", path: "/notifications", body: SendNotification, response: Notification, idempotent: true },
  digest: { method: "GET", path: "/habitats/:habitatId/digest", response: Digest },
} as const;
