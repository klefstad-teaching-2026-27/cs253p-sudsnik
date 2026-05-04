# #928 — `LegacyOrder` is still imported outside the import tooling

**State** open · **Labels** contracts, debt · **Opened** Leslie Lamport, 2026-04-18

ADR-0007 narrowed `LegacyOrder` to the ledger import and deprecated it everywhere else. The type is still
exported from `contracts` and is still importable, so "deprecated" is a convention and not a rule.

I found two places reading `LegacyOrder.status` and deciding things with it. Both have been fixed. There is
nothing stopping the third.

## Comments

**Margaret Hamilton** — Can we not just delete it?

**Leslie Lamport** — The import tooling still takes it as its input shape and nobody owns that tooling. The ADR says so.

**Margaret Hamilton** — Then it is going to keep happening. Can the lint rules catch it?

**Leslie Lamport** — Not without a rule that knows about one type, which feels wrong. Leaving open.
