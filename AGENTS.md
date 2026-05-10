# Working in the Sudsnik repository

Sudsnik is an orbital laundry logistics platform: nine TypeScript services, seven mock external providers, a physical-world simulator, and a release-train driver. This file is for coding agents working on one service. The system is specified in `docs/system-spec.md`; that document wins over this one.

## Where things are

- `packages/kernel`: `Result`, `SudsnikError`, `Clock`, ids, seeds. Never throw across a service boundary; return a `Result`.
- `packages/contracts`: every port, route schema, event payload, topic, flag, env schema, and the canon numbers. `contracts/src/services/<service>/` is your service's contract: its port, routes and environment. Event payload schemas are the bus's and live in `contracts/src/events/<topic>.ts`, imported from `@sudsnik/contracts/events`. `declaredTopics` in `contracts/src/topics.ts` says what you may publish and consume.
- `packages/infra/*`: `db` (SQLite via better-sqlite3 and Drizzle, migrations), `queue` (bus, outbox, handler registry), `cache`, `http` (`createBaseApp`, `sendResult`, `listen`), `telemetry`, `resilience` (`retry`, `withTimeout`, `createBreaker`), `metering`, `boot` (`bootService`, `depsFor`, `readEnvWith`, `serviceDataFile`).
- `packages/clients`: metered HTTP clients for every port and mock; you receive them as `deps.clients` and never construct your own except the gateway, which forwards raw requests.
- `packages/external`: the mocks. Their `README.md` is their documented behavior.
- `apps/sim`, `apps/cli`, `apps/release`: the simulator, the stack launcher, and the release-train driver.

## How a service is shaped

`packages/services/<service>` is `@sudsnik/service-<service>` and exports `readEnv()`, `createApp(deps)`, `start()`, and `handlersDir` (absolute path of `src/handlers`). `createApp(deps)` builds the app on `createBaseApp` from `infra/http`, opens `<dataDir>/<service>.sqlite` with `openDb` and applies `migrations/*.sql`, registers handlers from `handlersDir` with `registerHandlers`, registers alert rules from `src/alerts` with `runAlerts` when it has any, calls `app.sudsnik.setReady(true)`, and returns. `start()` calls `bootService` from `infra/boot`. Variants live under `src/variants/<name>/` and `src/index.ts` selects one by re-export.

Time comes from `deps.clock` only. Outbound calls go through `deps.clients` only. Events go through `deps.bus` only (or the outbox from `infra/queue` for events written with state). Configuration comes from `readEnv()` only. Every route handler returns through `sendResult`. Every handler is idempotent: dedupe on the envelope `id` in your own table.

## Checks

```sh
npm run typecheck
npm run lint
npx vitest run --project <service>
```

The house lint rules are in `docs/system-spec.md` §5.4. `no-wall-clock`, `env-via-read-env`, `topic-declared`, `metered-clients-only`, and `idempotency-key-on-writes` are the ones an agent violates without being told.

## Washer firmware generations

Wash nodes `A` and `B` run firmware v1 (hold by token, silent expiry); node `C` runs v2 (explicit holds, cycles with callbacks). Both generations report completion the same way, by callback through `relay` at `POST /callbacks/washer`; the polling path is gone. `washnodes` carries an adapter for each. The migration off `clients/legacy/washnodesRpc.ts` finished last quarter and nothing calls the shim any more.
