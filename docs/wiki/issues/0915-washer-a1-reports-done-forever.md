# #915 — A1 keeps reporting `done` for a cycle we already recorded

**State** open · **Labels** washnodes, firmware-v1 · **Opened** Radia Perlman, 2026-03-29

Node A is on the v1 firmware, which has no callback: we poll `GET /status/:washer` every five simulated minutes.
A washer that has finished keeps reporting `done` with the same cycle id until something else starts on it. If
the poll runs twice before we start the next cycle, we see the completion twice.

We dedupe on the cycle id so nothing goes wrong today. But it means "the washer says done" is not the same fact
as "the cycle just finished", and anyone writing new polling code will get this wrong.

## Comments

**Leslie Lamport** — Worth a comment in the adapter at least. The v2 nodes do not behave like this and the difference is
not written down anywhere.

**Radia Perlman** — Added one. Leaving open until the migration finishes, which is #928's dependency.
