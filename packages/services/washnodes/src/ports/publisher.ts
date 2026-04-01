import type { PayloadOf, Topic } from "@sudsnik/contracts";

export interface EventOrigin {
  tenantId: string;
  correlationId?: string;
  causationId?: string;
}

/** Records an event with the state change it describes; the outbox moves it to the bus. */
export interface Publisher {
  emit<T extends Topic>(topic: T, origin: EventOrigin, payload: PayloadOf<T>): void;
}
