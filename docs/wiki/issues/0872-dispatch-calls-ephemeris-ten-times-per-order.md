# #872 — dispatch calls ephemeris ten times for every order

**State** open · **Labels** dispatch, cost · **Opened** Radia Perlman, 2026-03-12

Reading the cost report after a `quiet-orbit` run. `dispatch` is our most expensive service by a factor of
four and it is almost all `EXTERNAL_CALL`.

Per order, on the scheduling path: `/windows` once, `/position` once per shuttle, which is six, and `/status`
once per node, which is three. Ten. At the baseline rate that is exactly our per-tenant quota, so we are one
busy orbit away from 429s.

## Comments

**Grace Hopper** — The windows for a habitat are the same all orbit. They are derived from the habitat index.
We are paying to be told a number we could compute.

**Radia Perlman** — Node status changes when a node goes dark, which is rare, and their own cache holds it for
minutes anyway. Nothing about this needs to be per order.

**Grace Hopper** — Positions are the one I would keep fresh, and even then only for the shuttles we are
choosing between.

**Radia Perlman** — Filed the numbers so whoever does it can check their work against them: golden ought to be
under a quarter of this.
