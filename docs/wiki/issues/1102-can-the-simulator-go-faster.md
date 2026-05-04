# #1102 — can we run the simulator faster than 600x?

**State** closed (declined) · **Labels** sim · **Opened** Radia Perlman, 2026-06-19

A full scenario is about two and a half minutes. At 1200x it would be one.

## Comments

**Leslie Lamport** — We tried 1800x early on. Every timing-sensitive test became flaky, because a simulated minute stops
being long enough for the work in it and the services start missing ticks.

**Radia Perlman** — Is that not itself a bug?

**Leslie Lamport** — It is a bug in the sense that the system would fall behind under a real load like that. It is not a
bug we want surfacing as a flaky suite. 600x is the number every canon figure was calibrated at. Closing.
