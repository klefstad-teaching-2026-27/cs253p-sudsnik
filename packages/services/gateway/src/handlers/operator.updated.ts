import type { Handler } from "@sudsnik/contracts";
import { OperatorUpdated } from "@sudsnik/contracts/events";
import { err, ok } from "@sudsnik/kernel";
import { operatorStoreFor } from "../operators/store.js";

const handler: Handler<OperatorUpdated> = {
  topic: "operator.updated",
  handle: async (envelope, deps) => {
    const payload = OperatorUpdated.safeParse(envelope.payload);
    if (!payload.success) return err({ code: "INVALID", message: `bad operator.updated payload: ${payload.error.message}`, retryable: false });
    const store = operatorStoreFor(deps);
    if (!store) return err({ code: "INTERNAL", message: "no operator store is bound to these deps; createApp(deps) binds it", retryable: true });
    const outcome = store.apply(envelope.tenantId, envelope.id, { ...payload.data, updatedAt: envelope.occurredAt });
    deps.telemetry.logger.info("operator_route_updated", { ...payload.data, tenantId: envelope.tenantId, outcome });
    return ok(undefined);
  },
};

export default handler;
