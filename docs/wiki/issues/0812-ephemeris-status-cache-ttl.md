# #812 — ephemeris status cache: the README says 60 s, the numbers say otherwise

**State** closed (wontfix) · **Labels** external, docs · **Opened** Margaret Hamilton, 2026-03-02

We size our own node-status cache off the provider's, and their README says the status endpoint is cached for
60 seconds. I spent an afternoon trying to work out why asking twice in two minutes gave the same `washersFree`
both times. It is not 60 seconds.

Measured: the same answer comes back for five minutes, to the second.

## Comments

**Grace Hopper** — Their support says the README is "aspirational". They changed it in an internal rewrite and
never shipped the docs. It is 300 s and has been since the v2 nodes went in.

**Margaret Hamilton** — Then our cache should be 300 s, not 60. We are paying for four calls out of five that cannot
return anything new.

**Grace Hopper** — Agreed, but I would rather not encode a number they might change back. Left a comment where
we read it. Closing as wontfix on the doc; the caching change is #847's problem.
