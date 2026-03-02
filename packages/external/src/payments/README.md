# payments

Mock payment processor. Every request needs `X-Sudsnik-Tenant`; `/_sim/*` does not.

| Endpoint | Behavior |
|---|---|
| `POST /authorize` | Body `AuthorizeRequest` (`contracts/src/mocks/payments.ts`). 201 with `PaymentResponse` in state `authorized`. |
| `POST /capture` | Body `{ paymentRef, amount? }`. 200, state `captured`; sends the `captured` webhook. 409 unless the payment is `authorized`. |
| `POST /refund` | Body `{ paymentRef, amount? }`. 200, state `refunded`; sends the `refunded` webhook. 409 unless `captured`. |
| `GET /_sim/stats` | `{ quotaRefusals: { total, byTenant } }`, counted over the whole run and never reset by `/_sim/state`. |

- `Idempotency-Key` is honored per tenant and route: a repeat returns the first reply with `idempotent-replayed: true`.
- Quota: 500 calls per orbit per tenant; beyond it, 429 with `Retry-After` in simulated seconds until the next orbit.
- 2% of calls time out: the reply is held and the socket is destroyed at the next `/_sim/state`. A `timeout-rate` fault replaces the rate.
- Webhooks are delivered at-least-once through `relay` to `POST <callbackUrl>/payments` with body `PaymentsWebhook`; 5% are sent twice with the same `id`. A `duplicate-webhook-rate` fault replaces the rate.
- Time comes from the latest `/_sim/state`; webhook `atMs` carries simulated latency of up to 2 s.
