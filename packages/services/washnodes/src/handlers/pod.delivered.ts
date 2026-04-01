import { PodDelivered } from "@sudsnik/contracts/events";
import { ok } from "@sudsnik/kernel";
import { handler } from "../app/handler.js";

/** The pod is at the node: start the cycle on its hold. An expired or unknown hold is already reported on the bus, so it is not retried. */
export default handler("pod.delivered", PodDelivered, async (rt, e) => {
  const r = await rt.service.startWash(e.payload.holdId, e.payload.podId, { tenantId: e.tenantId, correlationId: e.correlationId });
  if (r.ok || !r.error.retryable) return ok(undefined);
  return r;
});
