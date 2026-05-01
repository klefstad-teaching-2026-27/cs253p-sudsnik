# Runbook: the grader is not your laptop

What differs between a run on your machine and a run under the release train, and what each difference does to a
submission that assumed otherwise. Authority for every item is [`docs/autograder-spec.md` §3](../autograder-spec.md); this page is the
short form you read when a run passed locally and failed on submission.

## Ports and directories come from the environment

Locally every `SUDSNIK_*` variable has a default ([`docs/system-spec.md` §5.3](../system-spec.md)) and `npm start` works with none of
them set. Under the grader every one is set and no default applies.

**Symptom.** The stack answers on 4000 locally and nothing answers under the grader, or two services write to the
same SQLite file.

**What to do.** Read configuration through `readEnv()` and nothing else. A hard-coded port or a path relative to
the working directory is the defect; the house lint rule `env-via-read-env` catches the common shape.

## Working tree is read-only except the data directory

`$SUDSNIK_DATA_DIR` is the only writable path.

**Symptom.** `EACCES` or `EROFS` at boot, usually from a service writing beside its source.

**What to do.** Every file a service writes goes under `deps.dataDir`. `serviceDataFile(deps)` is how to name it.

## `NODE_ENV=production`

Permissive CORS is off and `/cost` needs a bearer token.

**Symptom.** `/cost` answers 401 under the grader and 200 locally, and the units band reads as unmeasured, which
scores nothing ([`docs/autograder-spec.md` §7.2](../autograder-spec.md)).

**What to do. Nothing, if you use the shared boundary**: `infra/http` verifies the token on `/cost` in production
already. A service that serves `/cost` itself has to do the same.

## No install runs on a submission

Image's `node_modules` is the only one, built from the golden lockfile; the staged tree gets a symlink
farm over it ([`docs/autograder-spec.md` §3](../autograder-spec.md)).

**Symptom.** A package you added to `package.json` is missing under the grader: typecheck fails to resolve it,
or the stack crashes at boot.

**What to do.** Use what the golden lockfile carries. A dependency the course does not ship is a request to
staff, not a line in `package.json`.

## SIGTERM arrives at the end of the run

In-flight orders are counted after the process exits ([`docs/system-spec.md` §10.2](../system-spec.md), lost on drain).

**Symptom.** `lost_on_drain` fails with orders that were mid-flight, which is the highest-weighted single item in
the stage.

**What to do.** Register every consumer, timer, and in-flight pass as a stop, in the order [`docs/system-spec.md` §5.1](../system-spec.md) item 8 gives:
timers and consumers first, then the outbox's final pump, then the database. A sweep that resumes after the
database closed is the usual cause.

## Memory is capped

Stack's Node heap is capped through `NODE_OPTIONS` (`NODE_HEAP_MB`, [`docs/autograder-spec.md` §3](../autograder-spec.md)), with no
address-space limit, since Node cannot start under one.

**Symptom.** The process dies mid-run with a heap-out-of-memory trace in the boot log, and every row of the stage
reports that the stack did not exit.

**What to do.** Do not hold a run's worth of anything in memory. Rows belong in SQLite; caches are bounded
(`infra/cache` takes a `max`); an unbounded `Map` keyed by order id is the usual cause.

## Run is bounded in wall time

Driver abandons a call after 30 seconds and the run after twice the wall time its orbits should take under the
grader (`deadline_factor` 2; four times locally).

**Symptom.** `RUN_DEADLINE` in the deploy log, with fewer orders placed than the scenario called for.

**What to do.** Look for a call with no timeout of its own, and for a handler that waits on something that never
arrives. Every outbound call goes through the injected clients, which take their timeout from the clock.

## Stack may be restarted mid-run

A scenario that names a restart orbit ([`docs/system-spec.md` §10](../system-spec.md)) has the stack stopped with `SIGTERM` and started
again on the same data directory while the clock keeps ticking. `dark-side` does, between its two dark windows.

**Symptom.** After the restart, a hold the store no longer knows about is never released, expired, or consumed by an
event, or two shuttles are sent to one washer: `no_forgotten_holds` or `no_double_launch` fails, and the deploy log's
stage shows `restarted mid-run`.

**What to do.** Keep every hold, reservation, and in-flight step in the service's SQLite file, and read it back in
`createApp(deps)` before reporting ready. A `Map` that a restart forgets is the usual cause.

## A run starts from an empty data directory

The bus and every service database live under `$SUDSNIK_DATA_DIR` and outlive the processes that wrote them, so a
run is judged on whatever is there. `npm run release` empties the directory before it boots a stack of its own; the
grader gives each stage its own.

**Symptom.** `DIRTY_ENVIRONMENT` in the deploy log, naming how many of an earlier run's order events were already
on the bus.

**What to do.** Nothing in the submission causes this: it is the harness handing the run a directory it did not
empty. Say so in the regrade request and quote the finding. Locally, `rm -rf data` and run again.
