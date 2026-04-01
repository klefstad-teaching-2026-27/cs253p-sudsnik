import { makeEnvelope } from "@sudsnik/contracts";
import type { Outbox } from "@sudsnik/infra-queue";
import type { Clock } from "@sudsnik/kernel";
import type { Publisher } from "../ports/publisher.js";

export function outboxPublisher(outbox: Outbox, clock: Clock): Publisher {
  return {
    emit: (topic, origin, payload) =>
      outbox.enqueue(
        makeEnvelope({
          topic,
          tenantId: origin.tenantId,
          occurredAt: clock.now(),
          ...(origin.correlationId ? { correlationId: origin.correlationId } : {}),
          ...(origin.causationId ? { causationId: origin.causationId } : {}),
          payload,
        }),
      ),
  };
}
