# Runbook: what a deploy log's finding codes mean

Every finding in a deploy log, `results/deploy-log.txt` unless the run was told to write elsewhere, carries one of the codes below, the keys of `FINDING_CODES` in
`apps/release/src/codes.ts`, and the finding's own line says what happened. Entry says what to look at; the grader environment's own
differences from a laptop are in [`docs/runbooks/grader-environment.md`](grader-environment.md).

## `READY_TIMEOUT`

Boot locally with every `SUDSNIK_*` variable set and watch how long `/ready` takes. Migrations that run before ready, a service that waits on another at boot, or a hard-coded port are the usual causes; [`docs/runbooks/grader-environment.md`](grader-environment.md) has each.

On your own machine, check first that nothing else is already holding the ports. A run started from `npm start`
in another terminal, or an earlier run that did not exit, keeps the stack's ports and the next run either
refuses with `EADDRINUSE` before any deploy log exists or boots far enough to miss this deadline. The ports are
fixed and there is no offset to move them, so the second run cannot simply pick others:

```sh
lsof -nP -iTCP:4000 -iTCP:4100 -sTCP:LISTEN
```

Anything listed is a stack you left running. Stop it and run again. This costs longer to find than it should,
because the finding reads as though your own service were slow to become ready.

## `BOOT_CRASH`

The stack's log tail is in the finding. A migration that fails, a module that throws at import, or a dependency the lockfile lacks are the usual causes.

## `TOKEN_FAILED`

`identity` refused a token for an operator: check `SUDSNIK_TENANT_KEYS` reaches the process unchanged.

## `PLACE_FAILED`

`POST /v1/orders` answered non-2xx or nothing. Look at the gateway's and orders' logs around the first failure; a known fault the driver retries is not this.

## `PLACE_SLOW`

Placement p95 is over the SLO. Find what the placement path awaits: a synchronous call to another service or a provider on the request path is the usual cause.

## `TURNAROUND_MISSED`

Fewer orders than the SLO fraction came back within six orbits. Read the incident's stuck orders and trace one through the services.

## `LOST_ON_DRAIN`

An order accepted with 2xx was not in `orders.sqlite` after `SIGTERM`. Register every stop in the order [`docs/system-spec.md` §5.1](../system-spec.md) item 8 gives, and write the order before answering.

## `UNGRACEFUL_EXIT`

The stack did not exit within the drain deadline. A timer or consumer that is never stopped, or a sweep that resumes after the database closed, is the usual cause.

## `STUCK_ORDERS`

Orders were left without a state change for three orbits. The incident lists their ids and states; trace one from its last event.

## `DEAD_LETTERS`

Messages were dead-lettered. Read the bus's dead-letter table for the topic and the error; a handler that throws on a repeat is the usual cause.

## `UNDECLARED_TOPIC`

A service published or consumed a topic `declaredTopics` does not list for it. Change the contract first if the topic is right, never the service alone.

## `TENANT_LEAK`

A response or event carried another operator's id. Scope every query by `tenantId` and never build a payload from a row another tenant owns.

## `INVARIANT_FAILED`

A scenario invariant failed; the finding names it and [`docs/system-spec.md` §10](../system-spec.md) defines it.

## `SIM_FAILED`

The simulator did not complete the run. This is the harness, not the submission; say so in a regrade request and quote the finding.

## `DIRTY_ENVIRONMENT`

The data directory was not empty at boot. This is the harness, not the submission; [`docs/runbooks/grader-environment.md`](grader-environment.md) says what to do.

## `RUN_DEADLINE`

The run passed its wall-clock deadline and was judged on what it reached. Look for a call with no timeout of its own.

## `COST_UNAVAILABLE`

`/cost` could not be read, so the units band scores nothing. Serve `/cost` through the shared boundary, which verifies the bearer token in production.

## `REPORT_FAILED`

`POST /v1/support/reports` answered non-2xx. The route and its schema are in `support`'s contract.

## `CANCEL_FAILED`

`GET /v1/orders/:orderId` before the cancel, or `POST /v1/orders/:orderId/cancel` for an order in a cancellable state, answered non-2xx. Both routes and the states are in `orders`' contract.

## `RESTART_FAILED`

The stack did not come back from the mid-run restart the scenario asked for. Boot it twice on the same data directory locally and read the second boot's log.
