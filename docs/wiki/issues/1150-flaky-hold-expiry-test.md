# #1150 — `washnodes` hold expiry test is flaky

**State** open · **Labels** tests · **Opened** Barbara Liskov, 2026-07-08

`test/public/expiry.test.ts` fails about one run in six on my machine and never on CI.

## Comments

**Radia Perlman** — Which assertion?

**Barbara Liskov** — The one that says the hold is still held at `HOLD_TTL_MS - 1`. Sometimes it has already gone.

**Radia Perlman** — I think that test is wrong rather than flaky. It advances the clock and then reads, and the
sweep runs on the same clock, so whether the sweep has run yet depends on ordering the test does not control.
The behaviour it is asserting is not the behaviour we want either — expiry is "past `expiresAt`", not "at".

**Barbara Liskov** — Skipped it with a comment rather than fix it wrong. Someone who understands the sweep should
look. Leaving open.
