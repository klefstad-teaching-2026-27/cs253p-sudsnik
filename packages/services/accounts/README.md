# `@sudsnik/service-accounts`

Operators, habitats, and crews, with each operator's pricing tier and region. Read-mostly: the only write is `PUT /operators/:operatorId`, which applies a patch of `name`, `pricingTier`, `region` and publishes `operator.updated` through the transactional outbox when something changed. `createApp` also announces the operators it owns: before reporting ready it publishes one `operator.updated` per seeded operator through the same outbox, with fresh envelopes each boot, so consumers can build their view without waiting for an update. Every read is tenant-scoped: an operator sees itself and its own habitats; anything else is 404. It consumes nothing and calls nothing outbound.

## Tables (`accounts.sqlite`, seeded by `migrations/`)

| Table | Rows | Key columns |
|---|---|---|
| `operators` | `op1` to `op4` from canon | `operator_id`, `name`, `pricing_tier`, `region`, `currency` |
| `habitats` | `hab01` to `hab12`, `idx` 0 to 11, three per operator | `habitat_id`, `operator_id`, `idx`, `name` |
| `crews` | three per habitat | `crew_id`, `habitat_id`, `name`, `preferences` (JSON, two keys) |

`0001_canon.sql` creates the tables and seeds the canon rows; `0002_operator_currency.sql` moves `op3` to `AUD`. A migration is recorded by filename and skipped once applied, so a value that has already shipped moves in a new file rather than by editing the seed.

## Layout

`src/schema.ts` (Drizzle tables), `src/repositories/*.ts` (one per table), `src/publish.ts` (the `operator.updated` envelope), `src/announce.ts` (the startup announcement), `src/routes/*.ts` (one per resource, shared by golden and naive), `src/variants/<name>/` (the port implementation per variant), `src/handlers/` (empty: nothing consumed). Tests: `test/public/<route>.test.ts` run against golden and naive, `test/public/hollow.test.ts`, `test/contract/`, `test/hidden/`.

## Variants

| Variant | Behaviour |
|---|---|
| `golden` | Rows cached in-process per id (TTL one orbit, invalidated on update); tenant check on every call |
| `hollow` | 501 `UNAVAILABLE` on every port route; infra routes only; announces nothing and publishes nothing |
| `naive` | No cache; every read a fresh query; `crew` joins habitat and operator on every call |
