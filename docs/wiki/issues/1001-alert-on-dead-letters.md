# #1001 — nothing alerts on dead letters

**State** open · **Labels** observability, good-first-issue · **Opened** Margaret Hamilton, 2026-05-20

A message that fails five deliveries goes to `dead_letters` and nobody hears about it. There is a counter. It is
read by exactly nothing.

`notify` has an alert rule for its own dead letters. Nothing covers the bus's.

## Comments

**Barbara Liskov** — Happy to take this. What is the threshold?

**Margaret Hamilton** — Any growth, same as notify's. One dead letter is already a message nobody is going to look at.

*(unassigned)*
