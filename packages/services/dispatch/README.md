# `@sudsnik/service-dispatch`

Shuttle assignment for the physical flow: a pickup window and a wash-node hold for every placed order, a return window
when the wash completes, and ingest of the relay's `collected`, `delivered`, and `returned` callbacks. The contract is
`packages/contracts/src/services/dispatch/`, and what the service owes is `docs/system-spec.md` §9.4.

Modules by concern under `src/`: `scheduler.ts` (pickup, return, reassign, cancel, and the back-pressure queue),
`holds.ts` (node ranking and holds through `washnodes`), `shuttles.ts` (round-robin with trip capacity), `windows.ts`
(link windows), `ingest.ts` (relay callbacks), `store.ts` (every SQL statement), `publisher.ts` (events through the
outbox), `runtime.ts` (how directory-scanned handlers reach the app), `gate.ts` (the drain: every route, delivery, and
sweep runs through it), `app.ts` (the shared app), `strategy.ts` (what `src/variants/` supplies, which `src/index.ts`
selects).

The strategy is where `ephemeris` is reached and how far a relay callback is taken at its word. Planning a pickup asks
`ephemeris` for the link windows, then for the position of each of the six shuttles, and ranks the three nodes by asking
`/status` for each; a return window asks `/status` again for the node it leaves from. That is ten calls for an order,
asked again for the next one, and a refusal from `ephemeris` is that order's refusal until the queue comes round again.
Ingest takes a relay callback as delivered: its checksum is not re-derived and its id is not recorded, and each callback
applies the step of the journey its `kind` names, refusing only one that arrives more than a step ahead of where the
order has got to.

A pod holds a washer only once it has arrived: `order.placed` schedules a window and a node, the `delivered` callback
acquires the hold and publishes `pod.delivered`. A node with no idle washer is waited on, not polled: the pod is woken by
the `hold.released`, `hold.expired`, or `wash.completed` that frees a washer there, oldest waiting pod first, with a
once-per-orbit sweep as the backstop. Waiting is unbounded and is not a failure; running the attempts out is, and it
publishes `pickup.failed` with the reason and the attempt count in the same transaction that marks the order `failed`,
so an order dispatch abandons never goes quiet.

Tables in `dispatch.sqlite` (`migrations/`): `orders` (what `order.placed` said, how far the pod has come, and the node
it waits at), `assignments`, `holds`, `trips` (pods per shuttle per window), `rotation`, `shuttle_positions`,
`consumed_events` (envelope ids, written by every handler), `relay_callbacks` (callback ids, which the ingest does
not write), `rejected_callbacks` (a callback for an order dispatch does not know, or one out of
step), and the outbox.

On `SIGTERM` the stops run in reverse registration order: the timers and consumers stop, the gate refuses new work and
waits for the routes, deliveries, and sweeps already running, the outbox publishes what they wrote, and the database
closes last, so no statement can reach a closed database.
