import type { Handler } from "@sudsnik/contracts";
import { HoldReleased } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { nodeOfWasher } from "../holds.js";
import { withRuntime } from "../runtime.js";

const handler: Handler = {
  topic: "hold.released",
  handle(envelope, deps) {
    return withRuntime(deps, async ({ store, scheduler }) => {
      const payload = HoldReleased.safeParse(envelope.payload);
      if (!payload.success) return err(sudsnikError("INVALID", `hold.released payload: ${payload.error.message}`));
      const nowMs = deps.clock.now();
      if (!store.consumeEvent(envelope.id, envelope.topic, nowMs)) return ok(undefined);
      const p = payload.data;
      store.setHoldState(p.holdId, "released", nowMs);
      await scheduler.onWasherFreed(nodeOfWasher(p.washerId));
      return ok(undefined);
    });
  },
};
export default handler;
