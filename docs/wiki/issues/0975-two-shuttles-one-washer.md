# #975 — two shuttles were sent to the same washer

**State** open · **Labels** washnodes, data · **Opened** Margaret Hamilton, 2026-04-15

Node `B`, washer `B7`. Two orders, two holds, both live, both acquired within the same second. The second pod
arrived to find the machine running somebody else's laundry.

## Comments

**Margaret Hamilton** — `acquireHold` picks an idle washer, then calls the firmware, then writes the hold. Two calls
that pick the same washer before either writes both think they have it.

**Grace Hopper** — The window is the firmware call, which is a network hop. It is not a small window.

**Margaret Hamilton** — The hold store is a `Map`. There is nothing to serialise on. It also means a restart forgets
every live hold, which is its own problem.

**Grace Hopper** — SQLite would give us both: `BEGIN IMMEDIATE` around pick-and-write, and the holds still
there after a restart. A version column on the row so a stale writer loses instead of overwriting.

**Margaret Hamilton** — Which is a migration, and the holds table is already in use. Expand, migrate, contract.

**Grace Hopper** — Write the test that fails on the `Map` first, or we will not know we fixed it.
