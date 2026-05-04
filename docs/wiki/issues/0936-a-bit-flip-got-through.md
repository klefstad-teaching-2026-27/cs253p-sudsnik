# #936 — a corrupted callback body was applied

**State** open · **Labels** dispatch, tracking, safety · **Opened** Margaret Hamilton, 2026-04-02

A `position` callback came in with `orbitPhase: 0.7000000001` where the checksum says the body should have
read `0.7`. One character of the payload had flipped somewhere between the shuttle and us.

`tracking` rejected it. `dispatch` applied it.

## Comments

**Margaret Hamilton** — Every body the relay carries has a `checksum`, the first eight hex of SHA-256 over the
canonical JSON without the checksum field. `tracking` verifies it. `dispatch` does not.

**Radia Perlman** — Radiation. This is the whole reason the field exists.

**Margaret Hamilton** — A body that does not verify is a 400 and goes to the dead-letter table. It must not be
retried: it will not get better.

**Radia Perlman** — Worth saying out loud that the canonical JSON has to match theirs exactly or we reject
everything. Key order sorted at every depth, `undefined` members dropped.
