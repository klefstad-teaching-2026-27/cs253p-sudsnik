# #1012 — can we agree what "units per 10k" means

**State** closed (answered) · **Labels** cost, docs · **Opened** Barbara Liskov, 2026-04-28

Three of us quoted three different numbers for the same run in standup.

## Comments

**Radia Perlman** — Total units across every service, times ten thousand, divided by orders placed. Per service,
the same sum over that service's `/cost` only.

**Barbara Liskov** — So the system figure and a component figure are different numbers and both are called units
per 10k.

**Radia Perlman** — Yes, and the one that matters for a component is the component's. Eight services you did not
write will dilute anything you did to the ninth.

**Leslie Lamport** — Prices are in the canon table and nothing else sets them. A database read is 8, a queue publish is
10, an internal call is 64, an external one is 128, a connection is 256. A token is 0.05.

**Barbara Liskov** — Then the expensive thing is always the network and everybody's instinct to optimise the query
is wrong. Closing, this belongs in the spec and now it is there.
