# identity

Operator token issuer. Every request needs `X-Sudsnik-Tenant`; `/_sim/*` does not.

| Endpoint | Behavior |
|---|---|
| `POST /token` | Body `{ operatorId, key }`, checked against `SUDSNIK_TENANT_KEYS`. 201 with `{ token, operatorId, expiresAtMs }`; 401 on a wrong key. |
| `GET /verify` | Reads `Authorization: Bearer <token>`. 200 with `{ operatorId, scopes }`; 401 for a missing, unknown, or expired token. |
| `GET /_sim/stats` | `{ quotaRefusals: { total, byTenant } }`, counted over the whole run and never reset by `/_sim/state`. |

- 1% of `/verify` calls return 503 with `Retry-After: 1`. An `error-burst` fault replaces the rate.
- Tokens expire 100 orbits after issue; scopes are the fixed operator set in `src/identity/index.ts`.
- Time comes from the latest `/_sim/state`.
