import { makeEnvelope, type PayloadOf, type ServiceDeps, type Topic } from "@sudsnik/contracts";
import type { Outbox } from "@sudsnik/infra-queue";

export interface Cause {
  correlationId: string;
  /** The envelope or callback id this event answers. */
  causationId: string;
}

export interface Publisher {
  /** Writes the event to the outbox; call inside the transaction that writes the state it describes. */
  enqueue<T extends Topic>(topic: T, tenantId: string, payload: PayloadOf<T>, cause: Cause): void;
}

export function createPublisher(deps: ServiceDeps, outbox: Outbox): Publisher {
  return {
    enqueue(topic, tenantId, payload, cause) {
      outbox.enqueue(makeEnvelope({ topic, tenantId, occurredAt: deps.clock.now(), correlationId: cause.correlationId, causationId: cause.causationId, payload }));
    },
  };
}
