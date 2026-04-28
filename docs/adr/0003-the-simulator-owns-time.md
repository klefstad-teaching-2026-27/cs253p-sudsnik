# ADR-0003: The simulator owns time

- Status: accepted
- Date: 2026-02-25

## Context

An orbit is ninety minutes and a wash is forty-five. A test suite that waits for those is not a test suite. We
tried scaling the constants down for development and spent a week chasing behaviour that only appeared at the
real numbers.

## Decision

The simulator publishes `clock.tick` once per simulated minute at 600× wall time. `infra/queue` consumes it and
advances the process clock. Domain code reads `deps.clock`, never the wall clock, and a house lint rule says so.

## Consequences

Canon numbers stay at their real values and a full scenario runs in a couple of minutes.

Timeouts, retries and sweeps are all in simulated milliseconds and resolve at tick granularity, so a timeout
shorter than a minute resolves at the next minute. Every default is therefore stated in minutes.

Anything that runs outside the simulated world — the release driver, the mock servers' own deadlines — needs a
wall-clock bound of its own. That is a real edge and it has caught us more than once.
