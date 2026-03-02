# ephemeris

Orbital data service. Every request needs `X-Sudsnik-Tenant`; `/_sim/*` does not.

| Endpoint | Behavior |
|---|---|
| `GET /windows?habitat=` | The habitat's next three link windows as `{ startMs, endMs }`, from the canon link schedule. 404 for an unknown habitat. |
| `GET /position?shuttle=` | The shuttle's `orbitPhase` now. 404 for an unknown shuttle. |
| `GET /status?node=` | `{ inContact, washersFree }` for a wash node. Served from a cache with a 60 second TTL. 404 for an unknown node. |
| `GET /_sim/stats` | `{ quotaRefusals: { total, byTenant } }`, counted over the whole run and never reset by `/_sim/state`. |

- Quota: 100 calls per orbit per tenant; beyond it, 429 with `Retry-After` in simulated seconds until the next orbit. A `quota` fault replaces the allowance with `params.callsPerOrbit`.
- Every call, including one that gets 429 or 404, counts against the quota.
- Time comes from the latest `/_sim/state`.
