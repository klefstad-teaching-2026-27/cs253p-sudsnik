import type { Handler } from "@sudsnik/contracts";
import { OrderReturned } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { handlerContext } from "../handlerContext.js";

/** Records the returned order, its pod, and its habitat so a later report can reference them. */
const handler: Handler = {
  topic: "order.returned",
  async handle(envelope, deps) {
    const payload = OrderReturned.safeParse(envelope.payload);
    if (!payload.success) return err(sudsnikError("INVALID", `order.returned payload: ${payload.error.message}`));
    const { db, store } = handlerContext(deps);
    db.transaction(() => {
      if (!store.markHandled(envelope.id, envelope.topic, deps.clock.now())) return;
      const { orderId, podId, habitatId, returnedAt, orbitsElapsed } = payload.data;
      store.recordOrderReturned({ orderId, tenantId: envelope.tenantId, podId, habitatId, returnedAt, orbitsElapsed });
    });
    return ok(undefined);
  },
};
export default handler;
