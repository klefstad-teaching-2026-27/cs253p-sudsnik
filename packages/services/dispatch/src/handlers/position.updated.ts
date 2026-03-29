import type { Handler } from "@sudsnik/contracts";
import { PositionUpdated } from "@sudsnik/contracts/events";
import { err, ok, sudsnikError } from "@sudsnik/kernel";
import { withRuntime } from "../runtime.js";

/** Informational: the latest position per shuttle, kept for operators; scheduling does not read it. */
const handler: Handler = {
  topic: "position.updated",
  handle(envelope, deps) {
    return withRuntime(deps, async ({ store }) => {
      const payload = PositionUpdated.safeParse(envelope.payload);
      if (!payload.success) return err(sudsnikError("INVALID", `position.updated payload: ${payload.error.message}`));
      if (!store.consumeEvent(envelope.id, envelope.topic, deps.clock.now())) return ok(undefined);
      const p = payload.data;
      store.recordPosition(p.shuttleId, p.orbitPhase, p.observedAt);
      return ok(undefined);
    });
  },
};
export default handler;
