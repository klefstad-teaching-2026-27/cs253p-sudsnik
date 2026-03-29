import type { Handler } from "@sudsnik/contracts";
import { HoldAcquired } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { withRuntime } from "../runtime.js";

/** Informational: the HTTP result already drove the assignment; the event confirms the row. */
const handler: Handler = {
  topic: "hold.acquired",
  handle(envelope, deps) {
    return withRuntime(deps, async ({ store }) => {
      const payload = HoldAcquired.safeParse(envelope.payload);
      if (!payload.success) return err(sudsnikError("INVALID", `hold.acquired payload: ${payload.error.message}`));
      const nowMs = deps.clock.now();
      if (!store.consumeEvent(envelope.id, envelope.topic, nowMs)) return ok(undefined);
      const p = payload.data;
      const known = store.hold(p.holdId);
      if (known && known.state !== "held") return ok(undefined);
      store.upsertHold(
        { hold_id: p.holdId, tenant_id: envelope.tenantId, order_id: p.orderId, node_id: p.nodeId, washer_id: p.washerId, state: "held", acquired_at: envelope.occurredAt, expires_at: p.expiresAt },
        nowMs,
      );
      return ok(undefined);
    });
  },
};
export default handler;
