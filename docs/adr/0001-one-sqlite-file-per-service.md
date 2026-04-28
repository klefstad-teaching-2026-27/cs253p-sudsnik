# ADR-0001: One SQLite file per service

- Status: accepted
- Date: 2026-02-11

## Context

Nine services share one machine. A single database would give us joins across services and one place to look
when something is wrong, at the cost of letting any service read any other's rows. We have been burned by that
before: the pricing tier ended up read straight out of the accounts table by two services that were supposed to
learn it from an event.

## Decision

Each service owns one SQLite file under `$SUDSNIK_DATA_DIR`, named after the service. No service opens another's.
Anything one service needs from another it gets through the port or through an event it consumes.

## Consequences

There are no cross-service joins, and there will not be. A question that spans services is answered by asking
each of them, which is slower and is the point: the cost of the question is visible.

Migrations are per service and run in `createApp` before `/ready`. A service that cannot migrate does not serve.

The release train reads `orders.sqlite` directly after the run to decide whether an order was lost. That is the
one reader outside the service, it is read-only, and it happens after the process has exited.
