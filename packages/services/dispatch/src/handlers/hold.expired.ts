import type { Handler } from "@sudsnik/contracts";
import { HoldExpired } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { nodeOfWasher } from "../holds.js";
import { withRuntime } from "../runtime.js";

/** A hold expires only after arrival; the pod waits at its node for a new one and `pod.delivered` is republished. */
const handler: Handler = {
  topic: "hold.expired",
  handle(envelope, deps) {
    return withRuntime(deps, async ({ store, scheduler }) => {
      const payload = HoldExpired.safeParse(envelope.payload);
      if (!payload.success) return err(sudsnikError("INVALID", `hold.expired payload: ${payload.error.message}`));
      const nowMs = deps.clock.now();
      if (!store.consumeEvent(envelope.id, envelope.topic, nowMs)) return ok(undefined);
      const p = payload.data;
      const current = store.activeHold(p.orderId);
      store.setHoldState(p.holdId, "expired", nowMs);
      if (!current || current.hold_id === p.holdId) await scheduler.onHoldLost(p.orderId);
      await scheduler.onWasherFreed(nodeOfWasher(p.washerId));
      return ok(undefined);
    });
  },
};
export default handler;
