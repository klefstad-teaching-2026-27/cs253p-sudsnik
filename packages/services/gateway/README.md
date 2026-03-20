# gateway

The public API in front of every service. A request to `/v1/<service>/<rest>` or `/v2/<service>/<rest>` is
authenticated against `identity` (`Authorization: Bearer <token>`), scoped to the token's operator, and forwarded
to `SUDSNIK_<SERVICE>_URL` with the client's body, query string, `idempotency-key`, `x-correlation-id` and
`x-sudsnik-driver`; the upstream's status, body, `content-type`, `deprecation` and `sunset` come back. Each service
serves one surface and every version of a path lands on it, so `/v1/orders` and `/v2/orders` both reach `orders` at
`/orders`. Once `api.v2` is on, every `/v1` response carries `Deprecation: true` and `Sunset` (canon). A service whose
`<service>.enabled` flag is off answers 503 `<service> disabled`; an unknown service or version is 404.
`operator.updated` builds a per-operator routing record served at `GET /operators/:operatorId/route` for the
operator's own tenant.

`identity`'s answer is remembered per token for ten simulated minutes (`infra/cache`); a refusal is never
remembered, a bad or missing token is 401, and an `identity` that cannot answer is 503.

Modules: `auth.ts` (bearer parsing and verification), `verify.ts` (the cached verifier), `routing.ts` (version
and service resolution, upstream URL, and the `VersionPrefix` the variant supplies), `forward.ts` (the
forward route), `headers.ts` (what crosses in each direction), `upstream.ts` (the raw client and its answer),
`operators/` (the routing record), `handlers/operator.updated.ts`, `paths.ts` and `cost.ts`. `src/app.ts` holds
everything a variant does not, `src/variants/v1-only/` registers the forward and operator routes over it, and
`src/index.ts` selects it.

Tables (`migrations/`): `operators(tenant_id, operator_id, region, pricing_tier, currency, updated_at)`,
`handled_events(envelope_id, topic, handled_at)` for handler dedupe.

`createApp(deps, { http })` accepts an `HttpClient` so tests forward to a fake instead of a socket.
