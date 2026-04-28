# ADR-0009: Every physical fact arrives through relay

- Status: accepted
- Date: 2026-05-13

## Context

Pods are collected, delivered and returned in orbit; washers finish cycles on nodes that go dark. None of that
is something the ground can poll reliably, and we had three different ways of hearing about it: a callback from
the washer firmware, a shuttle telemetry feed, and a habitat uplink.

## Decision

One path. Anything physical reaches the ground as a `POST /deliver` through `relay`, with an origin, a
destination, a body and a checksum. `relay` holds a delivery whose origin is dark and refuses one whose
destination is.

## Consequences

One ingest to write per service that receives facts, one checksum rule, one place where duplicates and
reordering come from. A receiver that does not verify the checksum, deduplicate on the body id, or tolerate a
step arriving before the one it implies will be wrong in exactly the ways the storm scenario is built to show.

The relay's own documentation says it delivers exactly once and in order. It does not.
