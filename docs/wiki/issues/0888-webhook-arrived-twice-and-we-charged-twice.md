# #888 — the same payment webhook arrived twice and we charged twice

**State** closed (fixed) · **Labels** billing, payments · **Opened** Leslie Lamport, 2026-03-18

Operator `op3` was charged 4,900 twice for order `01HQ...8KX`. Two `capture` rows in the ledger, same amount,
90 seconds apart. Both webhooks carry the same `id`.

Their documentation says webhooks are at-least-once and about 5% arrive twice. We read that and built as if it
said once.

## Comments

**Margaret Hamilton** — The ledger is append-only, so we cannot delete the second row. We issue a correcting entry
and reconcile.

**Leslie Lamport** — Dedupe table keyed on the webhook id, checked inside the same transaction as the write. Not a
cache, not a `Set`: a restart must not forget what it has already applied.

**Margaret Hamilton** — Same for the outbound side. Every write we make to them carries an `Idempotency-Key` and they
honour it, so a retry of ours is free.

**Leslie Lamport** — Fixed and backfilled. Leaving this open a week in case another one shows up, then closing.
