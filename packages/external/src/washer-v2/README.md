# washer-v2

Firmware v2 washer API for the washers of every v2 node (canon: nodes `B` and `C`). Every request needs `X-Sudsnik-Tenant`; `/_sim/*` does not.

| Endpoint | Behavior |
|---|---|
| `POST /holds` | Body `{ washerId }`. 201 with `{ holdId, washerId, expiresAtMs }`; 409 for a second hold on a washer that is held or washing. |
| `DELETE /holds/:id` | 204; 404 for an unknown hold. |
| `POST /cycles` | Body `{ holdId, callbackUrl }`. 201 with `CycleResponse` in state `running`; 404 for an unknown hold, 409 for an expired one. The hold is consumed. |
| `GET /cycles/:id` | The cycle's current `CycleResponse`; 404 when unknown. |
| `GET /_sim/stats` | `{ quotaRefusals: { total, byTenant } }`, counted over the whole run and never reset by `/_sim/state`. |

- A hold lasts one orbit. A cycle lasts 45 minutes; 1% of cycles fault. A `cycle-fault-rate` fault replaces the rate.
- On completion the mock delivers `WasherCallback` through `relay` to `POST <callbackUrl>/washer` with origin `{ kind: "node", id: <the washer's node> }`, so a dark node delays the callback until contact. The same outcome is readable from `GET /cycles/:id`.
- Time comes from the latest `/_sim/state`; callbacks are sent when that call moves the clock past the cycle's end.
