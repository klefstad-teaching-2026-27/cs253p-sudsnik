import type { Handler } from "@sudsnik/contracts";
import { NotificationFailed } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { handlerContext } from "../handlerContext.js";

/** Records the failure; nothing else in this service acts on it. */
const handler: Handler = {
  topic: "notification.failed",
  async handle(envelope, deps) {
    const payload = NotificationFailed.safeParse(envelope.payload);
    if (!payload.success) return err(sudsnikError("INVALID", `notification.failed payload: ${payload.error.message}`));
    const { db, store } = handlerContext(deps);
    db.transaction(() => {
      if (!store.markHandled(envelope.id, envelope.topic, deps.clock.now())) return;
      const { notificationId, orderId, channel, reason } = payload.data;
      store.recordNotificationFailure({ notificationId, tenantId: envelope.tenantId, orderId: orderId ?? null, channel, reason, recordedAt: deps.clock.now() });
    });
    return ok(undefined);
  },
};
export default handler;
