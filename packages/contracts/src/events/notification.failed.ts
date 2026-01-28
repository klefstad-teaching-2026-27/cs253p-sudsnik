import { z } from "zod";
import { IdSchema } from "../common.js";
export const NotificationFailed = z.object({ notificationId: IdSchema, orderId: IdSchema.optional(), channel: z.string(), reason: z.string() });
export type NotificationFailed = z.infer<typeof NotificationFailed>;
