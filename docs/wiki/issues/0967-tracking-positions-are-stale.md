# #967 — pod locations are a minute behind

**State** closed (working as intended) · **Labels** tracking · **Opened** Radia Perlman, 2026-05-02

Ask `tracking` where a pod is straight after the event that moved it and you get the old answer. It catches up
within a minute.

## Comments

**Leslie Lamport** — That is the design. The location is built from events off the bus, and the bus is polled. If you
need read-your-writes you are asking the wrong service — ask the one that published the event.

**Radia Perlman** — Fair. Though it is the sort of thing somebody will "fix" by calling `ephemeris` on every read.

**Leslie Lamport** — Which is why there are two endpoints, one fresh and one cached, and the fresh one costs an external
call. Closing.
