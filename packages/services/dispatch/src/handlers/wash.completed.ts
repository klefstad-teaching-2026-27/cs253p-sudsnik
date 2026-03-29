import type { Handler } from "@sudsnik/contracts";
import { WashCompleted } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { nodeOfWasher } from "../holds.js";
import { ctxOf, withRuntime } from "../runtime.js";

const handler: Handler = {
  topic: "wash.completed",
  handle(envelope, deps) {
    return withRuntime(deps, async ({ store, scheduler }) => {
      const payload = WashCompleted.safeParse(envelope.payload);
      if (!payload.success) return err(sudsnikError("INVALID", `wash.completed payload: ${payload.error.message}`));
      if (store.wasConsumed(envelope.id, envelope.topic)) return ok(undefined);
      const p = payload.data;
      const nodeId = nodeOfWasher(p.washerId);
      const r = await scheduler.scheduleReturn(p.orderId, ctxOf(envelope, `${envelope.id}:return`), { nodeId });
      await scheduler.onWasherFreed(nodeId);
      if (!r.ok) return r;
      store.consumeEvent(envelope.id, envelope.topic, deps.clock.now());
      return ok(undefined);
    });
  },
};
export default handler;
