import type { Handler } from "@sudsnik/contracts";
import { OrderCancelled } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { ctxOf, withRuntime } from "../runtime.js";

const handler: Handler = {
  topic: "order.cancelled",
  handle(envelope, deps) {
    return withRuntime(deps, async ({ store, scheduler }) => {
      const payload = OrderCancelled.safeParse(envelope.payload);
      if (!payload.success) return err(sudsnikError("INVALID", `order.cancelled payload: ${payload.error.message}`));
      if (!store.consumeEvent(envelope.id, envelope.topic, deps.clock.now())) return ok(undefined);
      return scheduler.cancel(payload.data.orderId, `order.cancelled: ${payload.data.reason}`, ctxOf(envelope, `${envelope.id}:cancel`));
    });
  },
};
export default handler;
