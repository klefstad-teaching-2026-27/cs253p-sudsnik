# #941 — do we still need the outbox now that the bus is durable?

**State** closed (declined) · **Labels** infra, design · **Opened** Barbara Liskov, 2026-04-21

The bus is a SQLite file now, so a publish is durable the moment it returns. The outbox adds a table per service,
a pump, and a step in every drain. Could we publish straight to the bus and drop it?

## Comments

**Grace Hopper** — Durable is not the same as atomic. The row and the publish are still two writes to two
databases, and the gap between them is where #903's cousin lives: the state says the wash finished and nothing
was published.

**Barbara Liskov** — Right. The outbox is inside the same transaction as the state. Never mind.

**Grace Hopper** — Worth writing down, though. ADR-0002.
