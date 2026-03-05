# relay

Ground-to-orbit message relay. Every request needs `X-Sudsnik-Tenant`; `/_sim/*` does not.

| Endpoint | Behavior |
|---|---|
| `POST /deliver` | Body `DeliverRequest` (`contracts/src/mocks/relay.ts`). 202 with `{ accepted: true, deliveryId }`. |
| `GET /_sim/deliveries` | The habitat-bound deliveries recorded so far, as `HabitatDelivery[]`. |
| `GET /_sim/stats` | `{ quotaRefusals: { total, byTenant } }`, counted over the whole run and never reset by `/_sim/state`. |

- `origin` and `destination` are `{ kind, id }` with `kind` one of `habitat`, `node`, `shuttle`, `ground`; `ground` is never dark.
- A delivery to a dark destination is refused with 503 and `Retry-After` in simulated seconds.
- A delivery from a dark origin is held until the origin's next contact, then forwarded.
- Deliveries are forwarded to `POST <to><path>` with the caller's `X-Sudsnik-Tenant`, ordered, exactly once, and immediately, at `deliverAtMs` or on acceptance if that time has passed.
- Habitat-bound deliveries are recorded in the `deliveries` table of `<dataDir>/mocks/relay.sqlite` instead of forwarded.
- Time comes from the latest `/_sim/state`.
