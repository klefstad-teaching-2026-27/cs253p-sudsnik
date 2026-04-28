# ADR-0002: State and the event that describes it commit together

- Status: accepted
- Date: 2026-02-18

## Context

Publishing an event after a write is two operations with a gap between them. We lost 41 orders to that gap in
the first integration: the row said the wash was finished and nothing had been published, so the return leg was
never scheduled and the orders sat in `washed` until the run ended.

## Decision

Every service writes its outgoing events into an `outbox` table inside the transaction that writes the state
they describe. A pump moves them to the bus afterwards, at least once, and marks them published.

## Consequences

A crash between the write and the publish costs a duplicate, never a loss. Every consumer deduplicates on the
envelope id, which it was going to have to do anyway, because the bus is at-least-once.

The outbox is one more table per service and one more thing to drain. The drain order is fixed: timers and
consumers stop, the outbox pumps what it holds, then the database closes.
