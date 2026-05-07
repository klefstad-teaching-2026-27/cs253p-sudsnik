# APIs and endpoints

Page 3 of the primer. The stack is running and you have a token ([`02-http.md` §2](02-http.md)).

## 1. Endpoint, API, contract

An endpoint is one method and one path that a service will answer: `POST /orders` is one, `GET /orders/:orderId`
is another. An API is the set of them a service offers, together with what each accepts and what each returns.

The difference that matters in a system like this one is between the API as a thing you discover by trying it,
and the API as a thing written down that both sides compile against. Sudsnik has the second. Every route's
request and response shape is a zod schema in `packages/contracts`, and the service registers its routes with
those schemas rather than restating them. All four of `orders`' routes are registered in
`packages/services/orders/src/core/routes.ts`, and this is the first of them:

```ts
app.post("/orders", { schema: { headers: IdempotencyHeaders, body: PlaceOrder, response: { 201: Order } } }, async (req, reply) => sendResult(reply, await service.place(req.body, req.ctx), 201));
```

`PlaceOrder` and `Order` come from `packages/contracts/src/services/orders/routes.ts`. That is why the 400 on
[`02-http.md` §4](02-http.md) said `body/podId`: nobody wrote that check, the schema is the check.

This is the fact the whole course is built on. A contract that exists as a value, rather than as documentation,
is one the other side can be tested against while it is still absent.

## 2. Read the API off the running service

Because the routes carry their schemas, each service can generate its own OpenAPI document. Every service serves
it at `/openapi.json`:

```sh
curl -s http://127.0.0.1:4001/openapi.json | jq -r '.paths | keys[]'
```

```
/cost
/health
/openapi.json
/orders
/orders/{orderId}
/orders/{orderId}/cancel
/ready
/version
```

Three of those eight paths are `orders`' own, carrying the four routes of §1 between them. The other five are
the boundary every service mounts: `/health`, `/ready`, `/cost` and `/version` (`docs/system-spec.md` §5.1,
rule 2), and the document you are reading this from. Drill into one:

```sh
curl -s http://127.0.0.1:4001/openapi.json \
  | jq '.paths."/orders".post.requestBody.content."application/json".schema'
```

```json
{
  "type": "object",
  "properties": {
    "habitatId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "podId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "notes": {
      "type": "string",
      "maxLength": 500
    }
  },
  "required": [
    "habitatId",
    "podId"
  ]
}
```

It says `notes` is optional and at most 500 characters. Nothing in `orders` says that a second time, and nothing
could disagree with it.

## 3. Two APIs, one public and one internal

You have been calling two different things. Port 4001 is `orders` itself, and its paths start at the resource:
`/orders`. Port 4000 is `gateway`, the only service meant to be reachable from outside, and its paths are
`/v1/<service>/<rest>`: `/v1/orders`. `gateway` verifies the token, works out which operator you are, and
forwards the rest (`docs/system-spec.md` §9.2).

That is why [`02-http.md` §3](02-http.md) got a 401 from port 4000 without a token, and why the direct call to port 4001 in
[`02-http.md` §5](02-http.md) needed `X-Sudsnik-Tenant: op1` instead. One of those two is an API for customers and one is an
API for other services, and they have different rules about who may say who they are.

## 4. Exercise

`accounts` is a service you have not called. Read its API off the running system:

```sh
curl -s http://127.0.0.1:4006/openapi.json | jq -r '.paths | keys[]'
```

```
/cost
/habitats/{habitatId}
/habitats/{habitatId}/crew
/health
/openapi.json
/operators/{operatorId}
/ready
/version
```

Call `/operators/{operatorId}` for `op1`, through `gateway` rather than directly, and get this back:

```
{"operatorId":"op1","name":"Aurora Orbital Services","pricingTier":"standard","region":"us","currency":"USD"}
```

Work out the URL yourself from §3; if you get a 404 whose message begins `no route`, you have the path right and
the prefix wrong. Then ask the same document for the methods rather than the paths:

```sh
curl -s http://127.0.0.1:4006/openapi.json | jq -r '.paths | to_entries[] | "\(.key): \(.value|keys|join(", "))"'
```

One path answers two methods. Name it, and find in
`packages/contracts/src/services/accounts/routes.ts` the schema that the second method accepts as a body. It is
derived from another schema on the line above it rather than written out; say what that derivation does and why
it means the two can never drift apart.
