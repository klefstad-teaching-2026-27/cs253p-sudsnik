# ADR-0007: Orders have one shape; LegacyOrder is import-only

- Status: accepted, supersedes ADR-0004
- Date: 2026-04-16

## Context

ADR-0004 put `LegacyOrder` in `contracts` and let new code use it. A month later the two had drifted: the order
state machine grew `collected`, `washing` and `returning`, and `LegacyOrder.status` still had four values from
the old system. Two services were reading `status` and deciding things with it.

## Decision

`Order` in `contracts/src/services/orders` is the shape of an order. `LegacyOrder` stays, marked deprecated,
and is used by the ledger import and nothing else.

## Consequences

The import tooling keeps working and nothing else has to change today.

The deprecated type is still importable, so the rule is a convention rather than a compiler error. The Week 3
contract gate rejects a submission that declares it, which is where it is actually enforced.

Code comments that pointed at ADR-0004 as current rationale are now pointing at a superseded record. They have
not all been found.
