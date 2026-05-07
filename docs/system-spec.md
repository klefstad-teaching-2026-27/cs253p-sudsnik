# Sudsnik system specification

Functional specification of the course edition of Sudsnik. Written for the agents and engineers who build it. Grading is in `autograder-spec.md`; the course rationale and the writing rules are the instructor's own documents.

## 1. Scope

Sudsnik is an orbital laundry logistics platform: crews in low Earth orbit bag laundry into smart pods; the system schedules pickup by an autonomous shuttle, routes the pod to a wash node with a free washer, and returns it on a later orbit. The course edition is a running TypeScript system of nine services, seven mock external providers, a physical-world simulator, and a release-train driver. Students inherit it and replace one component per week.

The system must:

1. start with one command on a laptop, with no outbound network, in two topologies (§6);
2. run every scenario in §10 deterministically from a seed under a virtual clock;
3. meter every database query, cache access, queue publish, external call, and LLM token in canon units (§2.2);
4. expose every student-built component as a seam (§8) with the variants §8 lists.

Target size: 15,000 to 20,000 lines including tests and fixtures.

## 2. Canon

### 2.1 Premise and the mechanisms it requires

| Physical fact | Mechanism the system must contain |
|---|---|
| Ground-to-orbit links have latency and visibility windows | Asynchronous messaging; store-and-forward queue; eventual consistency on tracking reads |
| Shuttles and wash nodes lose contact behind the Earth | Partition handling; retries with backoff; idempotent handlers; reconciliation jobs |
| Radiation flips bits in pod and washer firmware | Payload validation; checksums; fault injection; dead-letter queue |
| Water and power are metered per orbit | Cost accounting; budgets; rate limits |
| Orbits are periodic and predictable | Scheduler; simulated time; turnaround SLO |
| Habitats belong to different operators | Multi-tenancy; per-operator authorization scopes |
| Washers have firmware generations | Versioned external API; adapters both ways; a half-finished migration |
| Crews describe pod problems in free text | LLM-backed triage; evals; injection guardrails; token budget |

The narrative names are canon: Sudsnik (company), habitat, operator (tenant), pod, shuttle, wash node, washer, wash cycle, orbit, link window, relay.

**The name.** Searched 2026-09-21: the exact string returns no company, application, or trademark. The nearest
hits are unrelated: `Sudnik`, a surname, and `Sudebnik`, a 1497 Russian legal code. This was a web search and
not a search of the USPTO register or of an application store's own index, so it lowers the risk rather than
clearing it. The name is a portmanteau coined here, the use is a teaching fiction rather than goods or services
offered in commerce, and a rename would reach the `@sudsnik/*` package scope and the `SUDSNIK_` environment
prefix; that cost is why the check is recorded rather than repeated.

### 2.2 Canon numbers

Fixed in `packages/contracts/src/canon.ts`. Every scenario, price, and SLO derives from these. Calibrated before the services are built. Calibration target: the naive variant of each seam costs at least twice the golden variant's units per 10,000 orders, which is the bar `autograder-spec.md §7.2` enforces; the measured figures are in `tools/fixtures/bands.yaml`.

| Quantity | Value |
|---|---|
| Operators (tenants) | 4 (`op1` to `op4`) |
| Habitats | 12 (`hab01` to `hab12`; 3 per operator) |
| Wash nodes | 3 (`A`, `B`, `C`); 12 washers each; firmware v1 on `A`, v2 on `B` and `C` |
| Shuttles | 6 (`sh1` to `sh6`); capacity 40 pods per trip; one habitat-to-node route per trip |
| Pod fleet | 2,400 (200 per habitat) |
| Orbit period (simulated) | 90 min |
| Link window per habitat per orbit | 10 min visible, 80 min dark; habitat index i (0 to 11) is visible during orbit minutes [7.5i, 7.5i + 10), the last habitat's window running past the end of one orbit into the start of the next |
| Wash node contact | Always in contact except during a `dark` fault (§10.3) |
| Shuttle transit | One orbit per leg: a pod collected at a habitat in orbit k reaches the node at the same orbit phase in orbit k + 1; the return leg likewise |
| Washer cycle | 45 min; cycle-fault rate 5% on v1, 1% on v2; a faulted cycle is retried on a free washer, three attempts per order |
| Hold | A reservation of an idle washer for a pod that has arrived at its node, to start a cycle within one orbit; the washer is free again when the cycle ends or the hold expires. Nothing is reserved while a pod is in transit |
| Washer capacity | 72 cycles per orbit across the fleet; baseline utilization 56%, which is the headroom the turnaround SLO needs once a pod waits an orbit in transit each way |
| Turnaround SLO | 95% of orders returned within 6 orbits (9 h) |
| Order-placement latency SLO | p95 ≤ 300 ms |
| Order rate | baseline 40 per orbit; peak 200 per orbit |
| Virtual clock rate | 600× wall time; one simulated minute is 100 ms of wall time, one orbit 9 s |
| Scenario length | The scenario's placement orbits (§10) plus a drain tail of 6 orbits with no placements |

Unit prices, in canon units:

| Operation | Units |
|---|---|
| `CACHE_READ` | 4 |
| `CACHE_WRITE` | 6 |
| `DB_READ` | 8 |
| `DB_LAZY_WRITE` | 12 |
| `DB_WRITE` | 15 |
| `QUEUE_PUBLISH` | 10 |
| `INTERNAL_CALL` | 64 |
| `EXTERNAL_CALL` | 128 |
| `CONNECTION` | 256 |
| `LLM_TOKEN` | 0.05 |
| Dollars per unit | $0.0001 |
| Currencies | `USD`, `EUR`, `AUD`, in `CURRENCIES`; which operator prices in which is seeded by `accounts` and reaches other services on `operator.updated` (§9.1) |
| Conversion table | `CURRENCY_RATE_BP`, in integer basis points of native minor units per 10,000 USD minor units, so a conversion is identical on every run |

Conventions for every payload, row, and response: time is simulated milliseconds since scenario start; money is an integer in minor units with a `currency` code; `orbitPhase` is a number in [0, 1); ids are strings.

## 3. Stack

| Layer | Default (laptop and grader) | Optional (local only, never graded) |
|---|---|---|
| Runtime | Node 20 LTS; TypeScript strict; npm workspaces; vitest | same |
| HTTP | Fastify with zod schemas; OpenAPI generated from the schemas | behind a reverse proxy |
| Database | SQLite in WAL mode via Drizzle; one file per service; migrations checked in and applied by the service's `createApp(deps)` before `/ready` | Postgres via docker compose |
| Queue | Outbox table per service plus a SQLite-backed queue with at-least-once delivery and visibility timeouts | Redis Streams |
| Cache | In-process LRU with TTL, metered | Redis |
| Observability | OpenTelemetry SDK exporting traces, metrics, and logs to a local JSONL file, read with `jq` | Jaeger and Grafana via compose |
| Externals | Mock HTTP servers (§7); every external call crosses a network boundary | same |
| Cost accounting | Metering middleware pricing every operation from §2.2; `/cost` per service and per endpoint | same |
| Physical world | Deterministic simulator process with a seeded virtual clock (§7.2, §10) | same |

Postgres is not used by any course path. The grader's memory, file-size, and process limits are in `autograder-spec.md` §3.

## 4. Repository layout

```
sudsnik/
  packages/
    kernel/            ids, Result and error types, clock interface, feature-flag interface
    contracts/         see below; semver-versioned
    infra/db  infra/queue  infra/cache  infra/http  infra/telemetry  infra/resilience  infra/metering  infra/boot
    external/          payments, ephemeris, identity, washer-v1, washer-v2, relay, oracle; one runner for all seven
    services/
      gateway/  orders/  dispatch/  washnodes/  billing/  tracking/  accounts/  notify/  support/
    clients/           typed service-to-service clients: HTTP, queue, and one legacy RPC shim
  apps/sim             physical-world simulator; scenarios; fault schedules; invariant judges
  apps/cli             start the stack; start the mocks; print cost, SLO, and progress reports
  apps/release         release-train driver shared by local `npm run release` and the grader
  docs/runbooks  AGENTS.md
  tools/fixtures  tools/lint     fixtures holds the band thresholds a run is scored against
  vitest.config.ts   one vitest project per package with a `test/` directory, named after the package
```

`packages/contracts`:

```
contracts/
  src/canon.ts           canon numbers and unit prices (§2.2); the `Sunset` date string for `/v1`
  src/envelope.ts        Envelope schema (§5.5)
  src/topics.ts          Topic union; `declaredTopics: Record<Service, { publishes: Topic[]; consumes: Topic[] }>` (§9.1 is its rendering)
  src/flags.ts           FlagName catalogue and Flags interface (§5.5)
  src/sim.ts             Scenario, FaultSchedule, FaultEvent, InvariantId, BandId (§10)
  src/clients.ts         the client interfaces a service receives in ServiceDeps (§9.11)
  src/deps.ts            ServiceDeps, Handler, AlertRule (§5.5)
  src/legacy.ts          deprecated LegacyOrder, which nothing in the starter imports
  src/common.ts          Ctx and the shared value schemas (ids, money, time)
  src/mocks/<mock>.ts    request, response, and callback schemas of each mock (§7)
  src/services/<service>/port.ts        the port interface (§9)
  src/services/<service>/routes.ts      zod request and response schemas per route; OpenAPI is generated from them
  src/services/<service>/env.ts         the service's env schema beyond the common set (§5.3)
  src/events/<topic>.ts  payload schema of each topic; the bus owns them, not the service that publishes
  src/services/<service>/v2/            the `/v2` contract of a service that serves a second surface; `contracts/src/topics.ts` names which services do
  src/events/index.ts    `payloadSchemas` keyed by topic, and every schema by name
  testing/fakeDeps.ts    `fakeDeps(seed): ServiceDeps` with in-memory fakes; imports nothing from `packages/clients`
```

Names in this section are the canonical list for packages, services, mocks, and apps. Compiled output is named `out/`, never `build/` or `dist/`, which the grader prunes at every depth when it stages a submission.

## 5. Service convention

### 5.1 Boundary

Every service package must:

1. be the package `@sudsnik/service-<name>` and export `readEnv()`, `createApp(deps)`, and `start()`; `createApp(deps)` returns a Fastify instance that does not listen, and resolves only after migrations are applied and handlers and alert rules are registered; `start()` is the multi-process entry: `readEnv()`, `infra/boot`, `createApp`, listen;
2. mount `infra/http`, which provides `/health`, `/ready`, `/cost`, `/version`, and error mapping;
3. keep domain logic in plain modules with no framework imports;
4. take all time from the injected clock; `Date.now()` and `new Date()` are forbidden in domain code;
5. make every outbound call through injected, metered clients from `packages/clients`;
6. publish and consume events only through the injected bus, only on topics `declaredTopics` lists for it, with idempotent handlers;
7. read configuration only from `readEnv()`, validated by zod; a missing variable fails `/ready`, not the first request;
8. on `SIGTERM`, stop accepting work, drain in-flight requests and consumers, then exit; the release train counts orders lost to an ungraceful stop;
9. keep state in its own SQLite file under `SUDSNIK_DATA_DIR`, and apply its checked-in migrations in `createApp(deps)` before reporting ready;
10. keep tests under `test/`, using `app.inject` and fixtures, never the network;
11. receive inbound callbacks, where §9 says it does, at `POST /callbacks/<source>` with `<source>` one of `relay`, `washer`, `payments`; a callback body carries its own id, and the route dedupes on it.

### 5.2 Interior

The convention fixes the boundary only. Module layout under `src/`, naming, error-wrapping style, schema style, and test organization are decided by each service's builder and are expected to differ between services.

### 5.3 Environment variables

Every Sudsnik-specific name is `SUDSNIK_` prefixed; `NODE_ENV` is the Node convention. Every service reads the common set; each service adds its own, declared in `contracts/src/services/<service>/env.ts`.

| Variable | Meaning |
|---|---|
| `SUDSNIK_PORT` | Listen port of this process; in `--single` the one port for the whole stack |
| `SUDSNIK_SEED` | Scenario seed; 16 hex characters. Sub-seed for a component = first 16 hex characters of SHA-256(`seed:componentName`) |
| `SUDSNIK_<SERVICE>_URL` | Base URL per service (`GATEWAY`, `ORDERS`, `DISPATCH`, `WASHNODES`, `BILLING`, `TRACKING`, `ACCOUNTS`, `NOTIFY`, `SUPPORT`); in `--single` all are `http://127.0.0.1:$SUDSNIK_PORT/<service>` |
| `SUDSNIK_DATA_DIR` | Directory for SQLite files and the OTel JSONL file; the only writable path under the grader |
| `SUDSNIK_BUS_URL` | Absolute path of the bus SQLite file; created by the first service that opens it |
| `SUDSNIK_CLOCK_RATE` | Virtual clock multiplier; default the canon rate (§2.2) |
| `SUDSNIK_TENANT_KEYS` | `op1:key1,op2:key2,...`; the identity mock issues a token for `POST /token {operatorId, key}` |
| `SUDSNIK_<MOCK>_URL` | Base URL per external mock (`PAYMENTS`, `EPHEMERIS`, `IDENTITY`, `WASHER_V1`, `WASHER_V2`, `RELAY`, `ORACLE`) |
| `SUDSNIK_SIM_URL` | Base URL of the simulator (§7.2) |
| `SUDSNIK_FLAGS` | Comma-separated names of flags that are on; unlisted flags are off (§5.5). The simulator reads it too, since an invariant about a flagged service is judged only while the flag is on (§10.2) |
| `SUDSNIK_SCENARIO`, `SUDSNIK_SCALE`, `SUDSNIK_FAULTS` | Read by the simulator only: scenario name, scale, path of the fault schedule JSON (§10) |
| `SUDSNIK_HIDDEN_SEED` | Read by the simulator only: what the `storm` hidden draw derives from under the grader, which sets it for the simulator and never for the stack, since the stack holds `SUDSNIK_SEED` and the starter ships the simulator's source (§10) |
| `SUDSNIK_SIM_TOKEN` | Read by the mocks, the simulator, and the driver, never by a service: when set, every mock `/_sim/*` route and the simulator's `/run` and `/finish` require it in the `x-sudsnik-sim-token` header (§7). The grader sets it for the driver and withholds it from the stack |
| `NODE_ENV` | `production` disables dev fallbacks: permissive CORS and unauthenticated `/cost` |

Default ports when a variable is unset: `gateway` 4000; `orders` to `support` 4001 to 4008 in §4 order; mocks 4100 to 4106 in §7 order; simulator 4200. In `--single` the stack is 4000.

### 5.4 House lint rules

Implemented in `tools/lint` as ESLint rules; run by `npm run lint`, which `make verify` calls, and in the grader build stage.

| Rule | Fails on |
|---|---|
| `no-wall-clock` | `Date.now()`, `new Date()`, `setTimeout` with a literal in `src/` outside `infra/`, `external/`, and `apps/` |
| `metered-clients-only` | `fetch`, `http`, `undici` imported outside `packages/clients`, `packages/external`, and `apps/` |
| `tenant-field-required` | A zod schema for a persisted row without `tenantId`; the envelope schema without `tenantId` |
| `no-cross-variant-import` | An import path containing `/variants/` from another package, from a sibling variant, or from shipped code other than the package's own `src/index.ts`, which is the selector (§8) |
| `env-via-read-env` | `process.env` outside `readEnv()` |
| `topic-declared` | A `bus.publish` or `bus.subscribe` with a topic string not exported from `contracts/src/topics.ts` |
| `idempotency-key-on-writes` | A POST or PUT route schema under `packages/services` without an `Idempotency-Key` header, except routes under `/callbacks/` |

### 5.5 Shared interfaces

Defined once in `kernel` and `contracts`; every service builds against them.

| Name | Where | Shape |
|---|---|---|
| `Result<T, E = SudsnikError>` | `kernel` | `{ ok: true, value: T } \| { ok: false, error: E }` |
| `SudsnikError` | `kernel` | `{ code: ErrorCode, message: string, retryable: boolean, cause?: unknown }` |
| `ErrorCode` and HTTP map | `kernel/src/errors.ts` | `INVALID` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `QUOTA` 429, `INTERNAL` 500, `UNAVAILABLE` 503, `TIMEOUT` 504 |
| `Stop` | `kernel` | `() => void` |
| `Clock` | `kernel` | `{ now(): number; after(ms: number): Promise<void>; every(ms: number, fn: () => void): Stop }`; `now()` is simulated milliseconds since scenario start, 0 before the first tick; `after` and `every` resolve at tick granularity (§6) |
| `Op` | `contracts/src/canon.ts` | Union of the operation names in §2.2 |
| `Envelope<P>` | `contracts/src/envelope.ts` | `{ id: string (ULID), topic: Topic, tenantId: string, occurredAt: number, correlationId: string, causationId: string, payload: P }`; `tenantId` is on the envelope only, and is `"system"` on `clock.tick` and `position.updated` |
| `Bus` | `contracts` | `{ publish(envelope): Promise<void>; subscribe(topic, handler, { consumer }): Stop }`; delivery at-least-once and, per consumer, in publication order across every topic it subscribes to, so a consumer never sees an effect before the cause another service published first; a failed message is retried after the visibility timeout while later messages continue; consumers poll the bus file every 50 ms of wall time; visibility timeout 5 simulated minutes; a message is dead-lettered after 5 deliveries into the `dead_letters` table of the bus file; a consumer's dedupe key is the envelope `id`; a topic subscribed after the consumer has already been delivered to receives what it missed, so a service registering its handlers one at a time loses nothing; the bus records `topic_use(service, topic, direction, count)` |
| `Meter` | `contracts` | `{ charge(op: Op, count: number, tags: { service, endpoint? }): void }`; `CONNECTION` is charged once per SQLite open and once per outbound HTTP socket; `LLM_TOKEN` once per prompt or completion token |
| `FlagName`, `Flags` | `contracts/src/flags.ts` | `Flags = { isOn(name: FlagName): boolean }`; catalogue: `orders.enabled`, `dispatch.enabled`, `washnodes.enabled`, `billing.enabled`, `tracking.enabled`, `accounts.enabled`, `notify.enabled`, `support.enabled`, `api.v2`; the CLI's default environment lists every `<service>.enabled`; a service whose flag is off is not started or mounted |
| `ServiceDeps` | `contracts/src/deps.ts` | `{ env: Record<string, string>, clock, bus, meter, flags, clients: Clients, telemetry, dataDir, handlersDir }`; `Clients` is the record of interfaces in `contracts/src/clients.ts` (§9.11) |
| `Handler` | `contracts/src/deps.ts` | Default export of each file in the directory a service passes as `handlersDir`: `{ topic, handle(envelope, deps: ServiceDeps): Promise<Result<void>> }`; `infra/queue/registry.ts` scans that directory and subscribes each |
| `ProcessContext` | `infra/boot` | `createProcessContext(env)` builds the per-process clock, bus connection, meter sink, and telemetry provider; `depsFor(ctx, service, dirs)` builds one service's `ServiceDeps` from it; `bootService(...)` is what a service's `start()` calls |
| `Telemetry` | `infra/telemetry` | OTel tracer, meter, and logger writing to `$SUDSNIK_DATA_DIR/otel/trace.jsonl` and `$SUDSNIK_DATA_DIR/logs/<service>.jsonl`; spans carry wall-clock timestamps and the attribute `sim.now` |
| `/cost` response | `infra/http` | `{ service, sinceMs, totalUnits, byOperation: Record<Op, { count, units }>, byEndpoint: Record<"METHOD /path", { count, units }> }` |
| `/version` response | `infra/http` | `{ service, version, contractsVersion, variant, gitSha }` |
| `AlertRule` | `contracts/src/deps.ts` | Default export of each file in a service's `alerts/` directory: `{ name, every: ms, evaluate(metrics: AlertMetrics): boolean }`; `AlertMetrics` is the `/cost` body plus the service's OTel counters by name; `infra/telemetry` evaluates rules on the clock and emits a log record with `event = "alert"` and `rule = name` when one fires; its `everyGuarded` is how a service registers any other repeating job, since `Clock.every` discards what its function returns and an unguarded rejection would end the process |

Packages are `@sudsnik/<name>`. The `contracts` range a service was built against is `peerDependencies["@sudsnik/contracts"]`. The selected variant is fixed by the text of `src/index.ts`, never by configuration.

Units per 10,000 orders = `totalUnits × 10000 ÷ ordersPlaced`, summed over every service's `/cost`. Summed over one service's `/cost` it is that component's figure, which is what a seam's cost band grades (`autograder-spec.md §7.1`).

## 6. Topologies

Root scripts: `npm start` runs `apps/cli start`; `npm run release` runs `apps/release`; `npm run typecheck`, `npm run lint`, and `npm test` run `tsc --noEmit`, ESLint with `tools/lint`, and the vitest workspace. `apps/cli` commands: `start [--single] [--no-mocks] [--no-sim]`, `mocks`, `cost [rootUrl]`. With no `SUDSNIK_` variable set, `apps/cli` fills every one with its default (§5.3, seed the public seed, data directory `./data`, the flags every `<service>.enabled`, tenant keys `op1:key1,...,op4:key4`).

`apps/cli start` runs each service whose flag is on as its own process on its own port (§5.3), with the bus as a shared SQLite queue file. `apps/cli start --single` mounts every enabled `createApp(deps)` under one Fastify server at `/<service>/`, with one bus instance over the same SQLite queue file, one clock, and one metering sink, all built by `infra/boot`; every mounted `createApp` resolves before the root reports ready. The root `/ready` is 200 only when every mounted service is ready; the root `/cost` and `/version` return arrays of the per-service responses. Both forms also start the seven mocks (`apps/cli mocks`, one process) and the simulator in idle mode (ticking, no orders, no faults) unless `--no-mocks` or `--no-sim` is given. The grader always uses `--single --no-mocks --no-sim` for the student process.

Time is owned by the simulator in both topologies. It publishes `clock.tick` on the bus once per simulated minute; `infra/queue` consumes `clock.tick` itself (consumer `<service>`) and advances the process's `Clock`; visibility timeouts and `Clock.after` and `every` are computed from the latest tick, so they resolve at one-minute granularity. In `--single` one `Clock` is shared by every mounted service. Wall time never enters domain code. `clock.tick` is never dead-lettered.

Both topologies must behave identically at the contract level. `make verify-full` runs `quiet-orbit` both ways and writes a deploy log for each, which are compared by hand: every invariant agrees as a boolean, and `units` agrees within 5%. In `--single`, an internal call is priced `INTERNAL_CALL` and a queue publish `QUEUE_PUBLISH` exactly as in multi-process; only latency differs, so the latency bands are not compared. Measured 2026-09-21 on `quiet-orbit` at scale 1: all six invariants agreed, `units` by 1.4%, and `p95` by 11.1%, which is one step of a band coarse enough that a single step is a tenth of it.

## 7. External mocks

Each mock is a Fastify server under `packages/external/src/<name>` with quotas, latency, and failure modes; `packages/external` also exports a runner that starts all seven in one process. Randomness comes from the mock's sub-seed (§5.3). Every mock requires the header `X-Sudsnik-Tenant` on every request except `/_sim/*`, returns 400 without it, and counts quotas per tenant by it. Every `/_sim/*` request must carry `SUDSNIK_SIM_TOKEN` in `x-sudsnik-sim-token` when the mock was started with one, and is refused with 403 otherwise (§5.3). Every mock exposes `POST /_sim/state` with body `{ clockMs, orbit, dark: string[], faults: FaultEvent[] }`, which the simulator calls once per simulated minute, and `GET /_sim/stats` returning `{ quotaRefusals: { total, byTenant } }` counted over the whole run; `dark` lists habitat and node ids currently out of contact; `faults` lists the schedule entries addressed to this mock whose `atOrbit` has been reached (§10.3). Mock latency is added to simulated timestamps only and never delays the request path; a timeout fault holds the response and destroys the socket at the mock's next `/_sim/state` call, and the caller's own clock-based timeout decides. Callbacks: a request that produces a callback carries `callbackUrl`; the mock delivers callbacks through `relay` `POST /deliver`. `relay` keeps its `deliveries` table in `$SUDSNIK_DATA_DIR/mocks/relay.sqlite`; the other mocks keep state in memory. Each mock ships a `README.md`, which is what the system was told the provider does; this table is what it does.

| Mock | Endpoints | Behavior |
|---|---|---|
| `payments` | `POST /authorize`, `POST /capture`, `POST /refund`, webhook `POST <callback>/payments` | Honors `Idempotency-Key`; webhooks at-least-once with 5% duplicates; 2% of calls time out; quota 500 calls per orbit per tenant, then 429 |
| `ephemeris` | `GET /windows?habitat=`, `GET /position?shuttle=`, `GET /status?node=` | Quota 100 calls per orbit per tenant, then 429 with `Retry-After`; `/status` is served from a cache with a 300 simulated-second TTL |
| `identity` | `POST /token`, `GET /verify` | Issues scoped tokens per operator from `SUDSNIK_TENANT_KEYS`; `/verify` reads `Authorization: Bearer` and returns `{ operatorId, scopes }`; 1% of `/verify` calls return 503 |
| `washer-v1` | `POST /hold`, `GET /status/:washer`, `POST /start`, `POST /release` | Hold TTL one orbit, expires silently; status by polling; 5% cycle faults; ignores `/release` on an expired hold and returns 200 |
| `washer-v2` | `POST /holds`, `DELETE /holds/:id`, `POST /cycles`, `GET /cycles/:id`, callback `POST <callback>/washer` | Explicit hold lifecycle; completion by callback through `relay` and readable by `GET /cycles/:id`; 1% cycle faults; returns 409 on a second hold for the same washer |
| `relay` | `POST /deliver`, `GET /_sim/deliveries` | Body `{ origin: { kind, id }, destination: { kind, id }, to, path, body, deliverAtMs }` with `kind` one of `habitat`, `node`, `ground`; `ground` is never dark. Returns 503 with `Retry-After` when the destination is dark; holds a delivery whose origin is dark until the origin's next contact; forwards `POST <to><path>` at-least-once with 8% duplicates and 5% of deliveries deferred one simulated minute, which reorders them within a link window; a refused forward is retried for 5 minutes; habitat-bound deliveries are recorded in its `deliveries` table instead of forwarded |
| `oracle` | `POST /complete`, `GET /usage` | Body `{ prompt, maxTokens }`; returns the completion of the fixture whose normalized `note` (trimmed, whitespace collapsed, lowercased) occurs in the normalized prompt; fixture sets `triage` and `hostile` (§7.1); counts prompt and completion tokens; a prompt matching no fixture returns a fixed refusal completion; never calls a real model |

### 7.1 Oracle fixtures

`packages/external/src/oracle/fixtures/<set>/<n>.json`:

```
{ "note": "...", "completion": "...",
  "expected": { "category": "...", "severity": "low|medium|high", "action": "clean|inspect|quarantine|escalate" },
  "injected": false }
```

`expected` is the eval key; `category` is one of `contamination`, `damage`, `moisture`, `odor`, `other`, `sensor`, `stain`; `injected` marks notes from the `hostile` set. The `triage` set has 60 fixtures, the `hostile` set 30. `note` is the join key between a report the driver posts (§10.2) and its fixture: the fixture whose normalized note occurs in the normalized report note, longest match first. A triage is correct when `category`, `severity`, and `action` all equal `expected`.

### 7.2 Simulator protocol

`apps/sim` is one process. It reads `SUDSNIK_SCENARIO`, `SUDSNIK_SCALE`, `SUDSNIK_FAULTS`, `SUDSNIK_SEED`, `SUDSNIK_BUS_URL`, `SUDSNIK_DATA_DIR`, every `SUDSNIK_<MOCK>_URL`, and every `SUDSNIK_<SERVICE>_URL`. It opens the bus file only after the stack's root `/ready` is 200. It serves:

| Endpoint | Meaning |
|---|---|
| `GET /clock` | `{ nowMs, orbit, orbitPhase, running }` |
| `POST /run` | Requires `SUDSNIK_SIM_TOKEN` when the simulator has one, as does `POST /finish`. Body `{ scenario, scale, seed, faultsPath?, extraFaults? }`; starts the scenario at the next tick; `faultsPath` replaces the known schedule, `extraFaults` adds to it, and `storm` always adds the hidden draw (§10); the injected schedule is written to `$SUDSNIK_DATA_DIR/sim/faults.json`, in a directory created at mode 700, where what the simulator writes is its owner's alone; 409 while a run is in progress; idle mode ticks without a scenario |
| `GET /status` | Orders observed by state, invariant results so far, faults injected so far |
| `POST /finish` | Body `{ alerts, readyTimeline, deadLetters, fixtures, placed?, cancelled? }` from the driver; judges the invariants and returns `oracle.json` |

The first tick is simulated minute 0 and every tick advances one minute. Each tick it publishes `clock.tick`, calls `POST /_sim/state` on every mock, and performs the physical flow in §10.3. A run's orbit 0 is the tick it starts on; fault `atOrbit` and time to detect are relative to it. At the end of the drain tail it writes `$SUDSNIK_DATA_DIR/sim/oracle.json`: `{ invariants: Record<InvariantId, { pass, detail }>, bands: Record<BandId, number>, faults: FaultEvent[], stuckOrders: { orderId, state, sinceOrbit }[], ordersPlaced: number, ordersReturned: number }`. Stuck orders are records rather than only prose in the invariant's detail, so the deploy log's incident carries the order ids a postmortem needs.

## 8. Seams

A seam is one student-replaceable component: a port interface in `contracts`, a factory the rest of the system calls, and variants side by side in the golden tree.

```
packages/services/billing/
  src/port.ts              re-export of BillingService from contracts
  src/index.ts             export { createBilling } from "./variants/<selected>"
  src/variants/golden/     complete
  src/variants/hollow/     responds 501 and publishes nothing; consumers degrade behind a feature flag
  src/variants/naive/      correct but expensive; calibrates the cost band
  src/variants/<starter>/  the variant the starter ships, where it is none of the three
  test/public/  test/contract/  test/hidden/
```

| Seam | Weeks | Variants beyond `golden`, `hollow`, `naive` | Starter variant |
|---|---|---|---|
| `orders` | 1 | `cancel-noop`: cancel returns 200 and changes nothing | `cancel-noop` |
| `billing` | 2, 3 | `double-charge`: no webhook dedupe of any kind; a redelivered `captured` webhook appends a second capture and publishes `charge.captured` again | `port-only`: the package holds `package.json`, `src/port.ts`, and an `src/index.ts` that exports nothing, and `billing.enabled` is off. `contracts/src/services/billing/` ships without its `v2/`: Week 2's deliverable is the package behind the contract, not the contract |
| `washnodes` | 4 | `memory`: in-memory `HoldStore` | `memory` |
| `dispatch` | 5, 6 | none | `naive`: synchronous fan-out and exactly-once relay ingest |
| `tracking` | 5 | none | `naive`: every read fetches `ephemeris` |
| `notify` | 6 | `exactly-once`: relay ingest without dedupe or ordering | `exactly-once` |
| `support` | 7 | `keywords`: keyword matcher | `keywords` |
| `gateway` | 8 | `v1-only`: negotiates one API surface per service and has no `/v2` adapter. `src/v2/index.ts` ships as a port: every variant that serves `/v2` reaches it through that file's `versionPrefix`, so the starter carries the name and not the implementation | `v1-only` |

The grader overlays the student's seam on the golden tree, never on a prior submission. Week 3 continues from the student's own Week 2 tree.

`test/hidden/` is the acceptance suite a seam is graded by and does not ship: it exists in the golden tree, and the grader runs its own pinned copy of it, rewritten to the submission's selector. Contract tests import `createApp` from the seam package, inject `ServiceDeps` built by `contracts/testing/fakeDeps(seed)`, and run as the vitest project named after the service.

Rules:

1. the port ships in every tree; the public contract tests under `test/contract/` ship in every tree except when the week's deliverable is the contract itself (Week 2, `billing`); the grader's contract gate runs a pinned hidden copy (`autograder-spec.md §2`);
2. `hollow` is a graceful absence, never a crash; every consumer of the seam has a flag-guarded degraded path;
3. worse variants are deterministically worse at the grading seeds;
4. variants never import each other;
5. the starter ships the starter variant in the table above;
6. every variant exports what `src/index.ts` takes from the one it selects, since selecting another is a
   substitution of that path and nothing else; `selectVariant` refuses a swap that would leave a tree that does
   not compile, which is the tree the carve writes and the calibration boots;
7. what one variant alone needs lives beside that variant. A difference expressed as a flag the variant sets on
   shared code (`{ dedupe: true }` against `{ dedupe: false }`) leaves the implementation where every tree
   carries it, and is a boolean parameter switching behaviour, which is a failure of abstraction on its own
   terms. A variant supplies a collaborator instead.

A submitted seam package must:

1. contain only the package directories the assignment names;
2. declare in `package.json` the `contracts` version range it was built against;
3. satisfy §5.1 and serve `/health`, `/ready`, `/cost`, `/version`;
4. pass the seam's contract tests;
5. publish and consume only the topics `declaredTopics` lists for it; the bus records topics per service during a run;
6. read configuration from the environment and keep state in its own SQLite file;
7. never import another package's `variants/`.

## 9. Services

Each service section lists: responsibility; port (the interface in `contracts/src/services/<service>/port.ts`); storage; topics published and consumed; outbound calls; seams (the weeks in which it is student-built). Port methods take a `Ctx = { tenantId, idempotencyKey?, correlationId }` as their last argument and return `Promise<Result<...>>`; argument and return types are zod schemas in the service's `routes.ts`. The envelope is `Envelope<P>` (§5.5). Public routes on `gateway` are `/v1/<service>/<rest>` and `/v2/<service>/<rest>`, forwarded to `<rest>` on `SUDSNIK_<SERVICE>_URL`, except that a service whose every route is rooted under `/<service>` keeps that segment (`orders`: `/v1/orders` and `/v1/orders/:orderId` forward to `/orders` and `/orders/:orderId`); every `/v1` response carries `Deprecation: true` and `Sunset: <date>` once `api.v2` is on.

### 9.1 Topic catalogue

Rendering of `declaredTopics` in `contracts/src/topics.ts`; payload schemas live in `contracts/src/events/<topic>.ts`, keyed by topic in `payloadSchemas`. They sit with the bus rather than with the service that publishes them: every consumer needs them, and a seam that is being replaced must not take them with it.

| Topic | Publisher | Consumers | Payload |
|---|---|---|---|
| `order.placed` | `orders` | `dispatch`, `notify` | orderId, habitatId, podId, requestedAt |
| `order.cancelled` | `orders` | `dispatch`, `notify` | orderId, reason, origin (`customer` or `system`), compensations: string[] |
| `order.returned` | `orders` | `billing`, `notify`, `support` | orderId, podId, habitatId, returnedAt, orbitsElapsed |
| `pickup.scheduled` | `dispatch` | `orders`, `tracking`, `notify` | orderId, podId, habitatId, nodeId, shuttleId, windowStart, windowEnd |
| `pod.collected` | `dispatch` | `orders`, `tracking` | orderId, podId, shuttleId, collectedAt |
| `pod.delivered` | `dispatch` | `orders`, `washnodes`, `tracking` | orderId, podId, nodeId, holdId, deliveredAt |
| `return.scheduled` | `dispatch` | `orders`, `tracking`, `notify` | orderId, podId, habitatId, nodeId, shuttleId, windowStart, windowEnd |
| `pickup.failed` | `dispatch` | `orders` | orderId, podId, habitatId, reason, attempts |
| `pod.returned` | `dispatch` | `orders`, `tracking` | orderId, podId, shuttleId, returnedAt |
| `hold.acquired` | `washnodes` | `dispatch` | holdId, washerId, nodeId, orderId, expiresAt |
| `hold.released` | `washnodes` | `dispatch` | holdId, washerId, orderId, reason |
| `hold.expired` | `washnodes` | `dispatch`, `orders` | holdId, washerId, orderId |
| `wash.started` | `washnodes` | `orders`, `tracking` | orderId, washerId, startedAt |
| `wash.completed` | `washnodes` | `orders`, `dispatch`, `billing` | orderId, washerId, completedAt, cycleUnits (water and power units the washer reports; `billing` prices them into the charge) |
| `wash.faulted` | `washnodes` | `orders`, `support` | orderId, podId, washerId, faultCode, attempt, final |
| `position.updated` | `tracking` | `dispatch` | shuttleId, orbitPhase, observedAt |
| `charge.captured` | `billing` | `orders`, `notify` | orderId, chargeId, amount, currency |
| `charge.failed` | `billing` | `orders`, `notify` | orderId, reason |
| `refund.issued` | `billing` | `orders`, `notify` | orderId, refundId, amount, currency |
| `notification.failed` | `notify` | `support` | notificationId, orderId, channel, reason |
| `anomaly.reported` | `support` | `washnodes` | reportId, podId, orderId, note |
| `triage.completed` | `support` | `washnodes`, `notify` | reportId, orderId, podId, category, severity, action, tokens |
| `operator.updated` | `accounts` | `gateway`, `billing` | operatorId, pricingTier, region, currency |
| `clock.tick` | `apps/sim` | every service | nowMs, orbit, orbitPhase |

### 9.2 `gateway`

Responsibility: public API; token verification through `identity`; tenant scoping; routing to services; API version negotiation (`/v1`, `/v2`). A `/v2/<service>/<rest>` request reaches `/v2/<rest>` on a service that serves a `/v2` surface and `<rest>` on one that does not, so a version a service never migrated keeps working.
Port: `GatewayRoutes`; no domain state.
Storage: `gateway.sqlite`: operator routing records from `operator.updated`, handler dedupe.
Topics: consumes `operator.updated` for the routing table.
Outbound: `identity`, every service over HTTP.
Seams: Week 8, from `v1-only` (§8); the `/v2` adapter lives here and in the affected service.

### 9.3 `orders`

Responsibility: order lifecycle state machine and saga coordination across `dispatch`, `washnodes`, `billing`; compensation on cancel.
Port: `OrdersService { place(cmd: PlaceOrder, ctx), cancel(orderId, reason, ctx), get(orderId, ctx), list(filter, ctx) }`.
Storage: `orders.sqlite`: orders, saga steps, outbox.
Topics: publishes `order.placed`, `order.cancelled`, `order.returned`; consumes `pickup.scheduled`, `pod.collected`, `pod.delivered`, `wash.started`, `wash.completed`, `wash.faulted`, `hold.expired`, `return.scheduled`, `pod.returned`, `pickup.failed`, `charge.captured`, `charge.failed`, `refund.issued`.
Outbound: `billing` (HTTP `authorize` on placement and `refund` on cancel, behind flag `billing.enabled`; with the flag off the order is placed with `payment = "pending"`), `dispatch` (queue).
Seams: Week 1 (cancel path with compensation).

States and the event that moves an order into each:

| Transition | Trigger |
|---|---|
| `placed` | `place` |
| `placed → scheduled` | `pickup.scheduled` |
| `scheduled → placed` | `hold.expired` (`dispatch` reschedules) |
| `scheduled → collected` | `pod.collected` |
| `collected → delivered` | `pod.delivered` |
| `delivered → washing` | `wash.started` |
| `washing → delivered` | `wash.faulted` with `final = false` |
| `washing → cancelled` | `wash.faulted` with `final = true`; compensation runs |
| `washing → washed` | `wash.completed` |
| `washed → returning` | `return.scheduled` |
| `returning → returned` | `pod.returned`; publishes `order.returned` |
| any state before `washing` → `cancelled` | `cancel`, with origin `customer`; or `pickup.failed`, with origin `system`. Compensation either way: `refund` if authorized, `hold.released` through `dispatch` |

`charge.captured`, `charge.failed`, and `refund.issued` change the order's `payment` field, never its state.

### 9.4 `dispatch`

Responsibility: shuttle assignment; node choice at scheduling; pickup and return scheduling against link windows; hold acquisition through `washnodes` when the pod arrives at the node; ingest of shuttle callbacks from `relay`; back-pressure under peak load.
Port: `DispatchService { schedulePickup(orderId, ctx), scheduleReturn(orderId, ctx), reassign(orderId, ctx) }`; `RelayIngest { accept }` is the Week 6 port for the callback route.
Storage: `dispatch.sqlite`: assignments, schedule, outbox, dedupe table for relay callbacks.
Topics: publishes `pickup.scheduled`, `pod.collected`, `pod.delivered`, `return.scheduled`, `pod.returned`, `pickup.failed` when it gives up scheduling an order, which is what keeps an abandoned order visible; consumes `order.placed`, `order.cancelled`, `hold.acquired`, `hold.released`, `hold.expired`, `wash.completed`, `position.updated`.
Outbound: `washnodes` (HTTP `acquireHold` on the `delivered` callback, retried every simulated minute while the node has no idle washer, and `releaseHold`; `dispatch` acts on the HTTP result and treats `hold.*` events as informational; `pod.delivered` is published once the hold is held), `ephemeris` (windows, positions, node status), `relay` (callbacks in at `POST /callbacks/relay`: `collected`, `delivered`, `returned`).
Seams: Week 5 (strategy: caching, batching, breaker; the naive variant calls `/windows` once, `/position` per shuttle, and `/status` per node on every order, 10 calls), Week 6 (relay ingest; the naive variant treats callbacks as exactly-once).

### 9.5 `washnodes`

Responsibility: washer inventory per node; hold lifecycle with TTL; cycle start on `pod.delivered` and completion; retry of faulted cycles; maintenance flags; firmware adapters for v1 and v2.
Port: `WashnodesService { acquireHold(nodeId, orderId, ctx), releaseHold(holdId, reason, ctx), startCycle(holdId, ctx), status(nodeId, ctx) }`; `HoldStore { acquire, release, consume, expire, get }` is a separate port for Week 4.
Storage: `washnodes.sqlite`: washers, holds (with version column), cycles, nodes, reports, dedupe, outbox. The starter's `HoldStore` is in-memory.
Topics: publishes `hold.acquired`, `hold.released`, `hold.expired`, `wash.started`, `wash.completed`, `wash.faulted`; consumes `pod.delivered`, `anomaly.reported`, `triage.completed`.
Outbound: `washer-v1`, `washer-v2`, `relay` (v2 completion callbacks in at `POST /callbacks/washer`).
Seams: Week 4 (durable `HoldStore` with transactions and optimistic concurrency; hold-expiry fix; one expand-migrate-contract migration; a race test that fails on the in-memory variant), Week 8 (a revealed-requirement candidate).

### 9.6 `billing`

Responsibility: pricing from canon and operator tier; authorize on placement for the quote with the canon expected cycle units, capture on return for the actual units, capped at the authorization; refund on cancel; append-only ledger; reconciliation against `payments`.
Port: `BillingService { quote(orderId, ctx), authorize(orderId, amount, ctx), capture(orderId, ctx), refund(orderId, ctx), ledger(filter, ctx) }`.
Storage: `billing.sqlite`: ledger (append-only), charges, webhook dedupe, outbox.
Topics: publishes `charge.captured`, `charge.failed`, `refund.issued`; consumes `order.returned`, `wash.completed`, `operator.updated`.
Outbound: `payments` (HTTP plus webhooks in at `POST /callbacks/payments`).
Seams: Week 2 (the package behind the contract: every route registered from the contract's schemas so validation and the OpenAPI document derive from them, the contract tests, and the `hollow` variant, not the contract itself, which already exists), Week 3 (the same package made golden-equivalent: webhook dedupe, refund on a cancelled order, and the rest of what the faults reach), Week 8 (a revealed-requirement candidate).

### 9.7 `tracking`

Responsibility: pod and shuttle positions; orbit-phase estimates; two read APIs for the same data at different unit cost (`GET /positions/:shuttle` fresh via `ephemeris`, `GET /positions/cached/:shuttle` from cache with lag).
Port: `TrackingService { position(shuttleId, ctx), positions(ctx), podLocation(podId, ctx) }`.
Storage: `tracking.sqlite`: last-known positions, pod locations.
Topics: publishes `position.updated`; consumes `pickup.scheduled`, `pod.collected`, `pod.delivered`, `wash.started`, `return.scheduled`, `pod.returned`.
Outbound: `ephemeris`, `relay` (position callbacks in at `POST /callbacks/relay`: `position`).
Seams: Week 5 (with `dispatch`).

### 9.8 `accounts`

Responsibility: operators, habitats, crews, preferences, ratings; pricing tier and region per operator.
Port: `AccountsService { operator(operatorId, ctx), habitat(habitatId, ctx), crew(habitatId, ctx), updateOperator(operatorId, patch, ctx) }`.
Storage: `accounts.sqlite`: operators, habitats, crews, seeded from canon by its migration.
Topics: publishes `operator.updated`, once per operator at startup so a consumer can build its view without asking, and again on every change.
Outbound: none.
Seams: Week 8 (a revealed-requirement candidate).

### 9.9 `notify`

Responsibility: templates; delivery through `relay` to habitats during link windows; digests when dark; dead-letter queue.
Port: `NotifyService { send(notification, ctx), digest(habitatId, ctx) }`.
Storage: `notify.sqlite`: outbox, deliveries, dedupe, dead letters.
Topics: publishes `notification.failed`; consumes `order.placed`, `order.cancelled`, `order.returned`, `pickup.scheduled`, `return.scheduled`, `charge.captured`, `charge.failed`, `refund.issued`, `triage.completed`.
Outbound: `relay` (habitat-bound deliveries; a 503 while the habitat is dark is retried at the next window).
Seams: Week 6 (with `dispatch`; the `exactly-once` variant sends once and marks delivered without handling a 503, a duplicate, or a failure).

### 9.10 `support`

Responsibility: pod anomaly reports in free text; triage into `{category, severity, action}`; escalation to maintenance through `washnodes`; token budget per orbit.
Port: `SupportService { report(report, ctx), triage(reportId, ctx), escalate(reportId, ctx) }`; `TriageWorkflow { classify }` is the Week 7 port.
Storage: `support.sqlite`: reports, triage results, eval fixtures.
Topics: publishes `anomaly.reported`, `triage.completed`; consumes `order.returned`, `wash.faulted`, `notification.failed`.
Outbound: `oracle`.
Seams: Week 7 (the starter is a keyword matcher; the golden variant is a single-call workflow with a validation step and an injection guardrail).

### 9.11 `clients`

`contracts/src/clients.ts` declares one interface per port and per mock; `packages/clients` implements them: HTTP clients for `gateway → services`, `orders → billing`, and `dispatch → washnodes`; queue clients for everything event-driven; mock clients for the seven externals, each setting `X-Sudsnik-Tenant`; one legacy RPC shim (`clients/legacy/washnodesRpc.ts`) used only by the v1 adapter path. Every client is metered. Client timeouts are simulated milliseconds on the clock, five simulated minutes by default; a timeout shorter than a tick resolves at the next tick.

## 10. Scenarios

Scenarios live in `apps/sim/src/scenarios/<name>.ts` and export `Scenario = { name, orbits, ordersPerOrbit: (scale) => number, faults: FaultSchedule, invariants: InvariantId[], bands: BandId[] }`; `FaultEvent = { atOrbit, orbits?, mock, kind, params }`; `FaultSchedule = { events: FaultEvent[] }`; `cancels` is the share of placed orders the driver cancels (§10.2); `restartAtOrbit` names the orbit at whose start the driver has the stack stopped with `SIGTERM` and started again on the same data directory (§10.2); `flags` names the flags the scenario needs on, which the driver adds to the environment when it boots a stack and the grader's manifest sets otherwise; `InvariantId` and `BandId` are the item names in `autograder-spec.md §7.1`; all types live in `contracts/src/sim.ts`. `orbits` counts placement orbits; the drain tail follows (§2.2). The public seed is `00000000c0ffee00`; the team seed is derived by the grader.

| Scenario | Orbits | Orders per orbit | Faults | Measures |
|---|---|---|---|---|
| `quiet-orbit` | 10 | 40 | Known: 2% payment timeouts, 5% duplicate webhooks; the driver cancels 10% of orders | Turnaround SLO; placement p95; no lost orders on `SIGTERM`; no stuck orders at end; every cancelled order compensated; every returned order charged exactly once while `billing.enabled` is on; units per 10k |
| `dark-side` | 12 | 40 | Node `B` (v2) dark for one orbit at orbit 4 and node `A` (v1) at orbit 7; 5% of v1 holds dropped by the firmware; link windows enforced; the stack is restarted at the start of orbit 6 | No two shuttles to one washer; no cycle started on a hold the washer had let lapse; every cycle that ran at the dark node was reported, which the completion callback `relay` held cannot do; where the pod goes afterwards is the shuttles' work, and at this scale the shuttles are the backlog; every hold that reached its expiry was ended by an event, `hold.released`, `hold.expired`, or the `wash.started` that consumed it, which a store that forgot its holds at the restart cannot do. Run at scale 2, where two arrivals contend for a node's last idle washer; overloaded by design, so no turnaround band |
| `laundry-day` | 8 | 40 × scale from orbit 2 (scale 5 = 200, the canon peak); overload by design, orders queue | `ephemeris` at quota | Placement p95 band; units per 10k band; breaker opens on 429; no dropped orders. No turnaround band |
| `storm` | 12 | 40 | Hidden draw from: relay duplicates 20%, out-of-order 30%, callback checksum bit flips, node `C` dark twice, `identity` 503 burst | Time to detect (first alert vs first fault); false green (SLO reported met while orders stuck); stuck orders at end; dead-letter count |
| `hostile-notes` | 6 | 40 | 30% of anomaly notes carry injected instructions from the `hostile` fixture set | Eval precision and recall against keyed fixtures; no `action = clean` on an injected note; tokens per 10k under budget |
| `migration` | 8 | 40 | Half the clients call `/v1`, half `/v2`; `api.v2` on; revealed requirement active | Neither client set left behind: each reaches the turnaround SLO, the two do not diverge by more than five points, and each reads its own orders back on its own version as that version renders it; deprecation header on every `/v1` response; no contract-test regression |

Fault schedules are JSON under `apps/sim/faults/<scenario>.known.json`; the hidden draw for `storm` is three to five of its candidates, always including a `duplicate-rate` or `bitflip-rate` fault, which are the kinds an ingest can see and time to detect anchors on, generated from `SUDSNIK_HIDDEN_SEED` where it is set and the run's seed otherwise, and stored with the run. A fault event applies from `atOrbit` for `orbits` placement orbits, or to the end of the run when `orbits` is absent.

| Mock | `kind` | `params` |
|---|---|---|
| `payments` | `timeout-rate`, `duplicate-webhook-rate` | `{ rate }` |
| `ephemeris` | `quota` | `{ callsPerOrbit }` |
| `identity` | `error-burst` | `{ rate }` |
| `washer-v1`, `washer-v2` | `cycle-fault-rate` | `{ rate }` |
| `washer-v1` | `hold-drop-rate` | `{ rate }`; the share of holds the firmware forgets as soon as it has issued the token, so the start that follows finds no hold and the reservation lapses where only the reserver is watching |
| `relay` | `duplicate-rate`, `reorder-rate`, `bitflip-rate` | `{ rate }`; the defaults are 0.08, 0.05, and 0 |
| `relay` | `dark` | `{ kind: "habitat" \| "node", id }` |

Quota arithmetic at the naive `dispatch` fan-out (10 `ephemeris` calls per order, §9.4): 100 calls per tenant per orbit at baseline, exactly the quota, and 500 at peak.

### 10.2 Driving a scenario

`apps/release` is the driver in both local and grader runs. Locally (`--boot`, the default) it empties `SUDSNIK_DATA_DIR`, then starts the stack through `apps/cli start`, the mocks, and the simulator, and stops them at the end. Under the grader (`--attach`) the stack is already running as another user and has those files open, so emptying the directory belongs to whoever booted it; the driver starts only the mocks and the simulator. `npm run release -- --scenario <name> [--single] [--seed <hex>] [--scale <n>] [--faults <path>] [--stage canary|production] [--assignment <id>] [--seam <service>] [--results <dir>] [--points <n>] [--deadline-factor <n>] [--attach] [--stack-pgid <n>]`; `--points` is what the stage's graded rows sum to, the stage's own total unless the grader names its group's; `--deadline-factor` multiplies the wall time the orbits should take into the run's deadline, four unless named; `--stack-pgid` is how an attached run is given the process group to drain, since a driver that did not start the stack cannot signal it; `--seam` takes one service or a comma-separated list, naming what the submission replaces and whose combined cost the units band grades; `--faults` adds events to the known schedule; results land in `<dir>/` (default `results/`) as `deploy-log.json`, `deploy-log.txt`, `cost.json`, and copies of the trace and of the logs a finding cites; the local ledger key is a constant in `apps/release/src/main.ts` unless `SUDSNIK_LEDGER_KEY` is set; the driver sends `SUDSNIK_SIM_TOKEN` on every simulator control call and mock `/_sim/*` read, generating one when the environment has none.

The driver obtains one token per operator from `identity`, then places orders with `POST /v1/orders` on `gateway` at the scenario's rate, retrying a retryable placement failure twice, which keeps a known fault from counting as a submission defect, round-robin over operators and habitats, choosing per habitat the next pod not currently in an open order. Where the scenario declares `cancels`, it cancels that share of the orders it placed with `POST /v1/orders/:orderId/cancel`, half of them minutes after placement and half an orbit and a half later, only while the order is still `placed` or `scheduled`, and hands the accepted ids to the simulator at `/finish`. The simulator's world collects nothing for a cancelled order: the crew keeps the pod (§10.3). It never polls orders: order progress is read from the bus by the simulator. In `hostile-notes` the driver also posts, for 30% of returned orders, `POST /v1/support/reports { orderId, podId, note }` with a `note` drawn by seed from the `triage` and `hostile` fixture sets in the scenario's mix. The simulator judges the scenario's invariants from the event stream and writes `oracle.json` (§7.2). It samples the stack's `/ready` once per orbit, which is what `false_green_absent` is judged over. Its own calls are bounded in wall time, and so is the run: the clock the driver holds advances only between its calls and can never end one, so a stack that stops answering would otherwise hang it and no deploy log would be written at all. A run that passes its deadline is judged on what it reached and says so. Where the scenario names `restartAtOrbit`, at the start of that orbit the driver stops the stack and starts it again on the same data directory while the clock keeps ticking: a stack it booted it restarts itself, leaving the mocks and the simulator up; under `--attach` it writes `restart.json` into the results directory, and whoever owns the stack stops the process group, starts it again, and writes `restart.done` there, carrying the new process group's id, once `/ready` answers, within the deadline `RESTART_DEADLINE_MS` in `apps/release/src/driver.ts` names, or the run reports `RESTART_FAILED` and goes on without the restart. At the end of the drain tail the driver sends `SIGTERM` to the stack it started, or to the process group `--stack-pgid` named, waits for exit, and writes `deploy-log.json` (`autograder-spec.md §8`); under `--attach` with no process group it reports the stack as still running, since it cannot drain what it cannot signal. A band it could not measure is left out of that log and scores nothing, and a run the stack accepted no order into scores zero. A run is judged from the bus and from the services' databases, both of which outlive the processes that wrote them, so an empty data directory is a precondition of judging one: a bus that already holds an earlier run's order events would credit its returned orders to this run and leave its pods in open orders, and the driver refuses such a run with `DIRTY_ENVIRONMENT` rather than scoring it. Only the order lifecycle counts: a stack that has merely booted has ticked, published positions, and seeded its operators.

Definitions used by invariants and bands:

| Term | Definition |
|---|---|
| Alert | A log record with `event = "alert"` (§5.5) |
| Time to detect | Simulated minutes from the first injected relay delivery fault an ingest can see (`duplicate-rate` or `bitflip-rate`) to the first alert naming a rule at or after it; every `storm` draw carries one, and a schedule with none anchors on its first. An identity outage is the gateway's to notice, a dark node is the reconciliation week's, and a one-minute deferral reorders nothing at forty orders an orbit |
| Cancelled order compensated | An order the driver cancelled that the bus shows cancelled with origin `customer`, with no physical progress after it beyond the world's own tick (`CANCEL_RACE_MS` in `apps/sim/src/judge.ts`; an order the world collected within that tick of the cancel was collected, and is not judged), refunded after any charge captured for it, and with no washer hold left active or consumed after it. The driver cancels only before collection, where no charge has been captured and no hold acquired, so a run exercises the cancellation itself; the refund and the hold are the contract suite's |
| Settled | A returned order carrying exactly one `charge.captured`; judged only while `billing.enabled` is on, and only for orders returned at least `SETTLEMENT_GRACE_MS` of `apps/sim/src/judge.ts` before the run ended, since the capture follows the return. The invariant holds when no more than `SETTLEMENT_TOLERANCE` of them, rounded up to at least one, are unpaid, a capture the provider timed out on still being on its retry, and none is charged twice |
| False green | A `/ready` of 200 and no alert during an orbit in which at least one order is stuck |
| Stuck order | Not in a terminal state and no state change for 3 orbits |
| Dropped order | An order the driver placed (2xx) that the event stream never mentions, that was cancelled with origin `system`, or that a service marked permanently failed. An order still queued or in flight when the run ends is not dropped: in a scenario that is overloaded by design, queueing is the correct behaviour and the bands measure what it costs |
| Breaker opened | A log record with `event = "breaker_state"` and `to = "open"` |
| Quota refusal | A 429 a mock counted in `GET /_sim/stats` (§7). `breaker_opens_on_429` is judged only where one occurred, since a submission whose caching never reaches the quota has nothing to break on. The count comes from the mock that refused rather than from the service being graded, which would let a submission with no guard report nothing and pass |
| Lost on drain | An order the driver placed (2xx) that is absent from `orders.sqlite`, or non-terminal with no saga step recorded, after `SIGTERM` and exit |
| Placement p95 | Wall-clock duration of spans named `http POST /v1/orders` |
| Turnaround | Orders returned within 6 orbits of placement ÷ orders placed, over every order placed that the driver did not cancel |
| Eval precision and recall | Over `triage.completed` joined to fixtures by the report's `note`, against `expected` |

### 10.3 Physical flow

The simulator subscribes to the bus as consumer `sim` and turns events into physical facts, delivered to services through `relay` as `POST /deliver` with `origin` the habitat, node, or shuttle side and `destination` `{ kind: "ground", id: <service> }`. Each delivery body carries `id` (ULID), `kind`, the fields below, `atMs`, and `checksum` = first 8 hex characters of SHA-256 of the canonical JSON of the body without `checksum`; a `bitflip-rate` fault replaces one character of `checksum`, and a receiver must reject a body whose checksum does not verify with 400 and dead-letter it.

| Event observed | Physical action | Delivery to |
|---|---|---|
| `pickup.scheduled` | At `windowStart`, if the habitat is in contact and the shuttle is at the habitat with capacity, the pod is collected | `dispatch`: `{ kind: "collected", orderId, podId, shuttleId }` |
| `order.cancelled` | A pickup still pending for the order is dropped; the crew keeps the pod, and nothing is collected for it | none |
| collected | One orbit later the pod is at the node named in `pickup.scheduled` | `dispatch`: `{ kind: "delivered", orderId, podId, shuttleId, nodeId }` |
| `pod.delivered` | Nothing; `dispatch` has acquired the hold at arrival and `washnodes` starts the cycle on the washer mock, which times the cycle and reports completion or fault by its own protocol (§7) | none |
| `return.scheduled` | At `windowStart`, if the node is in contact, the shuttle departs; one orbit later, at the habitat's next window, the pod is returned | `dispatch`: `{ kind: "returned", orderId, podId, shuttleId }` |
| every 5 simulated minutes | Each shuttle's position | `tracking`: `{ kind: "position", shuttleId, orbitPhase }` |

A `dark` fault adds the id to `dark` in `/_sim/state` for the event's `orbits`; habitats are additionally dark outside their link window (§2.2). While a node is dark, `washer-v2` callbacks from it are held by `relay`, `washer-v1` polling of it times out, and `ephemeris` `/status` for it still answers from cache.
