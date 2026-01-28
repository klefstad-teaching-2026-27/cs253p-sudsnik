import { z } from "zod";
import { newId } from "@sudsnik/kernel";
import { IdSchema, SimMsSchema, UlidSchema } from "./common.js";
import { SYSTEM_TENANT, SYSTEM_TOPICS, TOPICS, type Topic } from "./topics.js";

export const EnvelopeSchema = z.object({
  id: UlidSchema,
  topic: z.enum(TOPICS),
  tenantId: IdSchema,
  occurredAt: SimMsSchema,
  correlationId: IdSchema,
  causationId: IdSchema,
  payload: z.unknown(),
});

export interface Envelope<P = unknown> {
  id: string;
  topic: Topic;
  tenantId: string;
  occurredAt: number;
  correlationId: string;
  causationId: string;
  payload: P;
}

export interface EnvelopeInput<P> {
  topic: Topic;
  tenantId?: string;
  occurredAt: number;
  correlationId?: string;
  causationId?: string;
  payload: P;
}

export function makeEnvelope<P>(input: EnvelopeInput<P>): Envelope<P> {
  const id = newId();
  const tenantId = input.tenantId ?? (SYSTEM_TOPICS.includes(input.topic) ? SYSTEM_TENANT : undefined);
  if (tenantId === undefined) throw new RangeError(`envelope on ${input.topic} needs a tenantId`);
  return {
    id,
    topic: input.topic,
    tenantId,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId ?? id,
    causationId: input.causationId ?? id,
    payload: input.payload,
  };
}
