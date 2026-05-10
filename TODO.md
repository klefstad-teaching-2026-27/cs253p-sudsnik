# TODO

Kept by whoever remembers to. Older than it looks.

## Now

- [ ] Turn the ephemeris status cache back on. It was off for the January incident and nobody re-enabled it.
- [ ] `washnodes` polls v1 status every five minutes. Margaret thinks a minute is fine, Grace thinks it will blow
      the quota. Measure it before changing it.
- [ ] Finish the v2 firmware migration. `hold` and `status` still go through the RPC shim.
- [ ] The relay README is wrong about ordering. Fix the README or fix the relay, we agreed which and I forget.

## Soon

- [ ] Split `dispatch` scheduling from ingest. It is one file and it should not be.
- [ ] Per-operator currency. Leslie has a design doc somewhere. (Ask before starting: this may be done.)
- [ ] Drop `LegacyOrder`. Blocked on the import tooling, which nobody owns.
- [ ] Alert on dead letters. There is a counter; nothing reads it.
- [ ] Make `notify` retry the digest. Or maybe it does now.

## Someday

- [ ] Postgres.
- [ ] Replace SQLite-as-a-queue with something that was meant to be a queue.
- [ ] A staging environment.
- [ ] Delete this file and use the issue tracker like we said we would in March.

## Done (probably)

- [x] Idempotency keys on writes — the lint rule catches it now
- [x] One cost endpoint per service
- [x] Move the hold release runbook out of the wiki
