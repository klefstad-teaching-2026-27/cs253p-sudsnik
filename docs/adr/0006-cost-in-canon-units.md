# ADR-0006: Cost is metered in units, not currency

- Status: accepted
- Date: 2026-04-02

## Context

We want the cost of a design to be something the team can see while they are designing, not something finance
reports a month later. Real prices change, differ per region, and invite arguments about which cloud.

## Decision

Every metered operation has a fixed price in units: a database read is 8, a cache read 4, an internal call 64,
an external call 128, a connection 256. `/cost` reports units per service, by operation and by endpoint. The
unit-to-dollar rate exists in canon and is used nowhere that matters.

## Consequences

Two designs can be compared by a number nobody has to look up, and the number does not move when a provider
changes its price list.

The prices encode a judgement: a call across the network costs about eight database reads. That ratio is what
teaches the lesson, so it is stated once in `canon.ts` and never duplicated.
