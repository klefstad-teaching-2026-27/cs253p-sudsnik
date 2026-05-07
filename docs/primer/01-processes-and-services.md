# Processes and services

Page 1 of the primer. Ten pages, in the order the files are numbered, one sitting each:

1. `01-processes-and-services.md`
2. [`02-http.md`](02-http.md)
3. [`03-apis-and-endpoints.md`](03-apis-and-endpoints.md)
4. [`04-databases.md`](04-databases.md)
5. [`05-caches.md`](05-caches.md)
6. [`06-queues-and-events.md`](06-queues-and-events.md)
7. [`07-configuration.md`](07-configuration.md)
8. [`08-tests.md`](08-tests.md)
9. [`09-git-and-the-terminal.md`](09-git-and-the-terminal.md)
10. [`10-typescript.md`](10-typescript.md)

You can already program. What these pages assume you may not have done is run a system made of parts that talk to
each other over a network. Each page names one such part, points at it in the system in front of you, and ends
with an exercise that takes a few minutes and has an answer you can check.

Everything is run against Sudsnik itself. `README.md` says what Sudsnik is and how to set it up; do that first,
then come back.

## 1. Process and service

A process is one running program, with its own memory, its own file handles, and its own exit code. When it
stops, everything it held in memory is gone.

A service is a process that answers requests at an address. It has no user interface and no main loop of its own
work. It listens on a port and waits. Everything it needs to survive its own restart is written down somewhere
outside itself, which for Sudsnik means a file on disk.

Sudsnik is nine services. They are listed, with what each is responsible for, in `docs/system-spec.md` §9.

## 2. Start them

```sh
npm start
```

```
> sudsnik@0.1.0 start
> node --import tsx apps/cli/src/main.ts start

payments http://127.0.0.1:4100
ephemeris http://127.0.0.1:4101
identity http://127.0.0.1:4102
washer-v1 http://127.0.0.1:4103
washer-v2 http://127.0.0.1:4104
relay http://127.0.0.1:4105
oracle http://127.0.0.1:4106
stack   http://127.0.0.1:4000
  gateway    http://127.0.0.1:4000
  orders     http://127.0.0.1:4001
  dispatch   http://127.0.0.1:4002
  washnodes  http://127.0.0.1:4003
  billing    http://127.0.0.1:4004
  tracking   http://127.0.0.1:4005
  accounts   http://127.0.0.1:4006
  notify     http://127.0.0.1:4007
  support    http://127.0.0.1:4008
  payments   http://127.0.0.1:4100
  ephemeris  http://127.0.0.1:4101
  identity   http://127.0.0.1:4102
  washer-v1  http://127.0.0.1:4103
  washer-v2  http://127.0.0.1:4104
  relay      http://127.0.0.1:4105
  oracle     http://127.0.0.1:4106
  sim        http://127.0.0.1:4200 (default port 4200)
ready: http://127.0.0.1:4000/ready
{"service":"sim","event":"sim.idle","port":4200}
{"service":"sim","event":"sim.listening","port":4200,"clockRate":600,"mocks":["payments","ephemeris","identity","washer-v1","washer-v2","relay","oracle"]}
```

That is one terminal now occupied. Leave it running and open another for everything below.

On a busy machine the start sometimes stops instead with `SqliteError: database is locked` from one or two of
the services: they opened the shared queue file at the same instant and one lost. Press ctrl-C, `rm -rf data`,
and run it again.

Those are not nine programs in a trench coat. `apps/cli/src/start.ts` spawns one operating-system process per
service, each with its own port, plus one process for the seven mock providers and one for the simulator. The
ports are configuration with defaults, not constants; `docs/system-spec.md` §5.3 says where they come from.

## 3. Ask one of them how it is

Every service serves the same four routes whatever else it does, because they all mount `packages/infra/http`
(`docs/system-spec.md` §5.1). Two of them answer questions about the process itself:

```sh
curl -s http://127.0.0.1:4001/health
curl -s http://127.0.0.1:4001/ready
curl -s http://127.0.0.1:4001/version
```

```
{"ok":true,"service":"orders"}
{"ready":true,"service":"orders"}
{"service":"orders","version":"1.0.0","contractsVersion":"1.0.0","variant":"cancel-noop","gitSha":"unknown"}
```

`/health` means the process is alive and answering. `/ready` means it can take work: its database migrations have
run and its event handlers are registered. The two are different questions, and a service can be alive and not
ready for a while after it starts.

## 4. One that is not there

Ask all nine in a row:

```sh
for p in 4000 4001 4002 4003 4004 4005 4006 4007 4008; do
  printf '%s ' $p; curl -s --max-time 2 http://127.0.0.1:$p/version || echo '(no answer)'; echo
done
```

```
4000 {"service":"gateway","version":"1.0.0","contractsVersion":"1.0.0","variant":"v1-only","gitSha":"unknown"}
4001 {"service":"orders","version":"1.0.0","contractsVersion":"1.0.0","variant":"cancel-noop","gitSha":"unknown"}
4002 {"service":"dispatch","version":"1.0.0","contractsVersion":"1.0.0","variant":"naive","gitSha":"unknown"}
4003 {"service":"washnodes","version":"1.0.0","contractsVersion":"1.0.0","variant":"memory","gitSha":"unknown"}
4004 (no answer)

4005 {"service":"tracking","version":"1.0.0","contractsVersion":"1.0.0","variant":"naive","gitSha":"unknown"}
4006 {"service":"accounts","version":"1.0.0","contractsVersion":"1.0.0","variant":"golden","gitSha":"unknown"}
4007 {"service":"notify","version":"1.0.0","contractsVersion":"1.0.0","variant":"exactly-once","gitSha":"unknown"}
4008 {"service":"support","version":"1.0.0","contractsVersion":"1.0.0","variant":"keywords","gitSha":"unknown"}
```

Eight answer. Port 4004 has nothing listening on it, and the blank line after it is `curl -s` swallowing its own
complaint. Without `-s` it says so:

```
curl: (7) Failed to connect to 127.0.0.1 port 4004 after 0 ms: Couldn't connect to server
```

The banner printed a URL for `billing` all the same, because the banner prints the environment rather than the
outcome. A service whose feature flag is off is never started (`docs/system-spec.md` §5.5). `apps/cli/src/env.ts`
sets `SUDSNIK_FLAGS` to `DEFAULT_FLAGS`, and one line of `packages/contracts/src/flags.ts` says which flag that
default leaves out.

This is the first thing to get used to. A URL existing, a service being alive, and a service being ready are
three separate facts, and you find out which one you have by asking.

## 5. Exercise

Stop the stack with ctrl-C and start it again. Time how long it takes for `/ready` on port 4001 to answer 200,
by running this in the second terminal before you start it:

```sh
time (until curl -s -o /dev/null http://127.0.0.1:4001/ready; do sleep 0.2; done)
```

Then answer two things. First: `orders` writes its rows to `data/orders.sqlite`, which survived the restart. One
of the eight running services keeps part of its state in the process instead, so a restart loses it. Name it,
and name the field in its `/version` that gives it away. Second: the `variant` field on port 4006 is the only
one that reads `golden`. `docs/system-spec.md` §8 says what a variant is and lists which services have them; say
in one sentence why `accounts` is the odd one.
