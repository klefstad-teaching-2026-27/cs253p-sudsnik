# #990 — a 503 from identity loses the order behind it

**State** closed (fixed) · **Labels** gateway, resilience · **Opened** Radia Perlman, 2026-04-21

About one verify call in a hundred comes back 503. When it does, the gateway answers 503 and the placement is
gone. The CLI does not retry and neither does the console.

## Comments

**Radia Perlman** — Their own docs say 1% of `/verify` calls fail. It is not an outage, it is the rate.

**Barbara Liskov** — Retry with backoff on the retryable ones only. A 401 is not retryable; a 503 is.

**Radia Perlman** — Done, three attempts on the simulated clock with jitter. Worth knowing for anyone adding an
outbound call: the timeout is simulated milliseconds, not wall clock, and a timeout shorter than a tick
resolves at the next one.

**Barbara Liskov** — Closing. If this ever gets worse than 1% the answer is a breaker, not more retries.
