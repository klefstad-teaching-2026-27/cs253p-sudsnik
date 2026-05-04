# #984 — one anomaly note spent the whole orbit's token budget

**State** closed (fixed) · **Labels** support · **Opened** Barbara Liskov, 2026-05-14

A crew member pasted what looks like a whole maintenance log into an anomaly note. We sent it to the model, it
came back unparseable, we retried with the stricter prompt, and between them they spent most of the orbit's
allowance. Every triage for the rest of the orbit fell back to keywords.

## Comments

**Margaret Hamilton** — Two retries at most was the design. The problem is the size, not the count.

**Barbara Liskov** — Capped the completion at 64 tokens and the note itself is what it is. The budget is per orbit
and shared, so one bad note can still crowd out the rest, but it cannot do it twice now.

**Margaret Hamilton** — Good enough. Closing.
