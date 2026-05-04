# #847 — relay delivers the same callback twice, and sometimes out of order

**State** open · **Labels** external, correctness · **Opened** Leslie Lamport, 2026-03-11

The relay's documentation says ordered, exactly-once delivery. It is neither.

In one orbit of `quiet-orbit` I counted 31 duplicate callback ids out of 400, and four cases where `delivered`
arrived before the `collected` for the same pod. Every receiver has to deduplicate on the body id and tolerate a
step arriving before the one it implies, or we lose pods.

## Comments

**Grace Hopper** — Confirmed against the provider. Their own trace shows a retry after a partial write. They
will not be changing it: "at-least-once is the contract we operate, whatever the page says."

**Leslie Lamport** — So the page is wrong and we cannot fix the page. I will open a docs issue against them and write the
dedupe on our side. Leaving this open as the tracking issue for anyone who reads the page and believes it.
