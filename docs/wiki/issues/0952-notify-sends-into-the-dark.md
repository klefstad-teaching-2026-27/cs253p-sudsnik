# #952 — notify sends to habitats that cannot hear it

**State** open · **Labels** notify, relay · **Opened** Barbara Liskov, 2026-04-09

`notify` sends every notification the moment it is ingested. If the habitat is out of its link window the relay
answers 503 with a `Retry-After`, and we mark the notification delivered anyway.

Crews are missing the "your pod is on its way" message and getting the "your pod is back" one, because the
second happened to fall inside a window.

## Comments

**Barbara Liskov** — A habitat is visible ten minutes in ninety. Five sixths of what we send lands in the dark.

**Leslie Lamport** — There is a digest for this. It exists, it is served, and nothing writes to it.

**Barbara Liskov** — So: inside the window, send. Outside it, queue for the digest and sweep at the next window.
The window arithmetic is in canon, habitat index times 7.5 minutes.

**Leslie Lamport** — And a 503 is not a failure, it is a "not now". A failure is five attempts that all came back
refused, and that is a dead letter.
