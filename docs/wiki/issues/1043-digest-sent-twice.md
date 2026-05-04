# #1043 — the digest goes out twice after a long dark window

**State** closed (fixed) · **Labels** notify · **Opened** Grace Hopper, 2026-06-02

Habitat 7 was dark for two orbits. When it came back the crew got two copies of the digest a minute apart.

The sweep runs every minute and takes everything queued for a habitat that is now visible. The first pass sent
them; the second pass ran before the first had marked them delivered.

## Comments

**Barbara Liskov** — The pass was not guarding against itself. One pass at a time per habitat, and the second joins
the first instead of starting its own.

**Grace Hopper** — Confirmed on a rerun. Closing.
