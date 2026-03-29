import type { Handler } from "@sudsnik/contracts";
import { OrderPlaced } from "@sudsnik/contracts/events";
import { err, sudsnikError } from "@sudsnik/kernel";
import { withRuntime } from "../runtime.js";

const handler: Handler = {
  topic: "order.placed",
  handle(envelope, deps) {
    return withRuntime(deps, async ({ scheduler }) => {
      const payload = OrderPlaced.safeParse(envelope.payload);
      if (!payload.success) return err(sudsnikError("INVALID", `order.placed payload: ${payload.error.message}`));
      return scheduler.onOrderPlaced({ ...envelope, payload: payload.data });
    });
  },
};
export default handler;
