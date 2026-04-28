# ADR-0004: Import the pre-launch ledger from LegacyOrder

- Status: superseded by ADR-0007
- Date: 2026-03-04

## Context

The ledger has to carry the orders that ran before the platform existed. They live in an export from the old
system, shaped `{ id, customer, habitat, pod, created, status, amountCents }`, with `status` one of `NEW`,
`IN_PROGRESS`, `DONE`, `VOID`.

Rewriting the export was quoted at three weeks by the team that owns the old system, and they are not going to
do it.

## Decision

`LegacyOrder` goes in `contracts` as a shared type. The import tool reads it and writes one `capture` ledger
entry per `DONE` order. New code uses it too where it is convenient: the shapes are close enough.

## Consequences

One type describes two things: an order as the old system recorded it, and an order as this one does. We expect
that to be uncomfortable and are accepting it to get the import done.

## Why this was superseded

The discomfort arrived. `LegacyOrder.status` and the order state machine drifted apart within a month, and code
that had reached for `LegacyOrder` because it was convenient started carrying assumptions from a system nobody
runs any more. ADR-0007 narrows it to the import and deprecates it everywhere else.
