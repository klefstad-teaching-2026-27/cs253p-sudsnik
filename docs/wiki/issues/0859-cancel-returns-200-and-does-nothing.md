# #859 — cancel returns 200 and the order carries on regardless

**State** open · **Labels** orders, customer-facing · **Opened** Barbara Liskov, 2026-03-06

Support got a second complaint this week. A crew cancels a pod from the console, the console says it worked,
and the shuttle turns up for it anyway on the next window.

`DELETE` is not a thing we have, so cancel is `POST /v1/orders/:id/cancel`. It answers 200 with the order. The
order comes back in `scheduled`. Nothing is published. Nothing is compensated.

## Comments

**Margaret Hamilton** — That is my fault. I wired the route to `get` while the compensation was being designed and
meant to come back to it. The design is in ADR-0002's shape: state and event in one transaction, the refund
after it commits. The state machine already knows which states are cancellable.

**Barbara Liskov** — Do we at least answer 409 once the pod is washing? Cancelling a machine mid-cycle is not a
thing the firmware can do.

**Margaret Hamilton** — That part is decided, not built. `CANCELLABLE_STATES` in the contract is the list.

**Leslie Lamport** — Whoever picks this up: `dispatch` is listening for `order.cancelled` already and will release the
hold when it sees one. It has been listening for six weeks and has never seen one.
