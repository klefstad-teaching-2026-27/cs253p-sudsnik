# washer-v1

Firmware v1 washer API for the washers of every v1 node (canon: node `A`). Every request needs `X-Sudsnik-Tenant`; `/_sim/*` does not.

| Endpoint | Behavior |
|---|---|
| `POST /hold` | Body `{ washer }`. 201 with `{ holdToken, washer, expiresAtMs }`; 409 while the washer is held or washing. |
| `GET /status/:washer` | `{ state, cycleId?, cycleUnits?, faultCode? }`, state one of `idle`, `held`, `washing`, `done`, `faulted`. |
| `POST /start` | Body `{ washer, holdToken }`. 201 with `{ cycleId, startedAtMs }`; 409 without an active hold for that token. |
| `POST /release` | Body `{ washer, holdToken }`. Always 200 with `{ released }`; an expired or unknown hold releases nothing. |
| `GET /_sim/stats` | `{ quotaRefusals: { total, byTenant } }`, counted over the whole run and never reset by `/_sim/state`. |

- A hold lasts one orbit and expires silently: status simply reads `idle` again and a new hold succeeds.
- A `hold-drop-rate` fault is the share of holds forgotten as soon as the token is issued; `/start` then answers 409.
- A cycle lasts 45 minutes; completion is observed by polling status. 5% of cycles fault; a `cycle-fault-rate` fault replaces the rate.
- While the washer's node is dark, every call for it is held open and its socket destroyed at the next `/_sim/state`.
- Unknown washer ids get 404. Time comes from the latest `/_sim/state`.
