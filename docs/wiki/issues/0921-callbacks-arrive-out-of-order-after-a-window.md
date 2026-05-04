# #921 — `delivered` arrived before `collected` and dispatch refused it

**State** open · **Labels** dispatch, relay · **Opened** Grace Hopper, 2026-03-27

Order `01HR...2QP`. The relay delivered the `delivered` callback first and the `collected` one four minutes
later. We answered 409 to the first because the order had not been collected yet, and 200 to the second.

The pod is at the node. The order says it is still at the habitat.

## Comments

**Grace Hopper** — Our ingest walks the journey one step at a time and refuses anything that skips. That is
fine when they arrive in order.

**Margaret Hamilton** — They do not arrive in order. The relay defers about one delivery in twenty by a minute, which
inside a ten-minute window is enough to swap two.

**Grace Hopper** — Then a late `delivered` should apply the `collected` it implies and carry on, rather than
being refused. The steps are cumulative; there is a `progress` column already.

**Margaret Hamilton** — And a repeat of a step we have passed is not an error either, it is a duplicate. Those are
different answers to the caller and we currently give the same one.

**Grace Hopper** — Leaving open. This wants doing at the same time as the dedupe, they are the same handler.
