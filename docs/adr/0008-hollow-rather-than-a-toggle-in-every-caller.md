# ADR-0008: A hollow service, not a toggle in every caller

- Status: accepted
- Date: 2026-04-29

## Context

A service is sometimes absent: during an incident, during a migration, and for a whole week of the course. The
obvious answer is a flag at each call site and a branch around it. We counted the call sites for `billing` and
got eleven, in four services.

## Decision

An absent service still serves. Its `hollow` variant answers 501 on every port route, publishes nothing, and
keeps `/health`, `/ready`, `/cost` and `/version`. Callers check one flag — `<service>.enabled` — and take their
degraded path.

## Consequences

The degraded path is written once per caller instead of once per call site, and it is exercised by a scenario
rather than by a branch nobody runs.

A hollow service is a graceful absence and never a crash. A caller that treats 501 as fatal is the defect, and
the scenario that runs `billing` hollow is what finds it.
