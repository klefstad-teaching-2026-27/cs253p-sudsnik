# #903 — holds expire while the pod is still on the shuttle

**State** closed (fixed) · **Labels** dispatch, washnodes · **Opened** Grace Hopper, 2026-03-24

We acquire a washer hold when the pickup is scheduled. The pod then spends a whole orbit in transit. The hold's
TTL is one orbit. You can see where this goes.

183 of 270 holds expired before the pod reached the node, and 316 orders were stuck with nowhere to go.

## Comments

**Margaret Hamilton** — Why do we hold at scheduling at all? Nothing is reserved while a pod is in transit in the
physical world either — the washer is just sitting there.

**Grace Hopper** — Because the original design wanted to know a washer would be free before committing to the
launch. Which is a guarantee we cannot actually make across an orbit.

**Margaret Hamilton** — Then we should not pretend to. Hold when the pod arrives at the node, and publish
`pod.delivered` only once we have one.

**Grace Hopper** — Done. Hold attempts per order went from 29 to 2.17 and the stuck count to zero. Closing.
