import type { z } from "zod";
import { OperatorUpdated } from "./operator.updated.js";
import { ChargeCaptured } from "./charge.captured.js";
import { ChargeFailed } from "./charge.failed.js";
import { RefundIssued } from "./refund.issued.js";
import { PickupFailed } from "./pickup.failed.js";
import { PickupScheduled } from "./pickup.scheduled.js";
import { PodCollected } from "./pod.collected.js";
import { PodDelivered } from "./pod.delivered.js";
import { PodReturned } from "./pod.returned.js";
import { ReturnScheduled } from "./return.scheduled.js";
import { NotificationFailed } from "./notification.failed.js";
import { OrderCancelled } from "./order.cancelled.js";
import { OrderPlaced } from "./order.placed.js";
import { OrderReturned } from "./order.returned.js";
import { AnomalyReported } from "./anomaly.reported.js";
import { TriageCompleted } from "./triage.completed.js";
import { PositionUpdated } from "./position.updated.js";
import { HoldAcquired } from "./hold.acquired.js";
import { HoldExpired } from "./hold.expired.js";
import { HoldReleased } from "./hold.released.js";
import { WashCompleted } from "./wash.completed.js";
import { WashFaulted } from "./wash.faulted.js";
import { WashStarted } from "./wash.started.js";
import { ClockTickSchema } from "../sim.js";
import type { Topic } from "../topics.js";

export const payloadSchemas = {
  "order.placed": OrderPlaced,
  "order.cancelled": OrderCancelled,
  "order.returned": OrderReturned,
  "pickup.scheduled": PickupScheduled,
  "pickup.failed": PickupFailed,
  "pod.collected": PodCollected,
  "pod.delivered": PodDelivered,
  "return.scheduled": ReturnScheduled,
  "pod.returned": PodReturned,
  "hold.acquired": HoldAcquired,
  "hold.released": HoldReleased,
  "hold.expired": HoldExpired,
  "wash.started": WashStarted,
  "wash.completed": WashCompleted,
  "wash.faulted": WashFaulted,
  "position.updated": PositionUpdated,
  "charge.captured": ChargeCaptured,
  "charge.failed": ChargeFailed,
  "refund.issued": RefundIssued,
  "notification.failed": NotificationFailed,
  "anomaly.reported": AnomalyReported,
  "triage.completed": TriageCompleted,
  "operator.updated": OperatorUpdated,
  "clock.tick": ClockTickSchema,
} as const satisfies Record<Topic, z.ZodType>;


/** Every event payload schema, and the type it infers; the bus is what owns them, not the service that publishes. */
export { AnomalyReported, ChargeCaptured, ChargeFailed, HoldAcquired, HoldExpired, HoldReleased, NotificationFailed, OperatorUpdated, OrderCancelled, OrderPlaced, OrderReturned, PickupFailed, PickupScheduled, PodCollected, PodDelivered, PodReturned, PositionUpdated, RefundIssued, ReturnScheduled, TriageCompleted, WashCompleted, WashFaulted, WashStarted };

export type PayloadOf<T extends Topic> = z.infer<(typeof payloadSchemas)[T]>;

export function parsePayload<T extends Topic>(topic: T, payload: unknown): PayloadOf<T> {
  return payloadSchemas[topic].parse(payload) as PayloadOf<T>;
}
