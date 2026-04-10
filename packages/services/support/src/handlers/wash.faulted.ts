import type { Handler } from "@sudsnik/contracts";
import { WashFaulted } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { handlerContext } from "../handlerContext.js";

/** Opens a report for a washer fault and triages it like any other. */
const handler: Handler = {
  topic: "wash.faulted",
  async handle(envelope, deps) {
    const payload = WashFaulted.safeParse(envelope.payload);
    if (!payload.success) return err(sudsnikError("INVALID", `wash.faulted payload: ${payload.error.message}`));
    const { db, store, service } = handlerContext(deps);
    const ctx = { tenantId: envelope.tenantId, correlationId: envelope.correlationId };
    const note = `washer ${payload.data.washerId} fault ${payload.data.faultCode}`;
    const opened = db.transaction(() => {
      if (!store.markHandled(envelope.id, envelope.topic, deps.clock.now())) return undefined;
      return service.open({ orderId: payload.data.orderId, podId: payload.data.podId, note }, ctx);
    });
    if (opened) await service.complete(opened, ctx);
    return ok(undefined);
  },
};
export default handler;
