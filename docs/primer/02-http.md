# HTTP requests, responses, status codes, and JSON

Page 2 of the primer. The stack is running ([`01-processes-and-services.md` §2](01-processes-and-services.md)).

## 1. What is on the wire

An HTTP request is a method, a path, some headers, and optionally a body. A response is a three-digit status
code, some headers, and optionally a body. That is the whole protocol as far as this course is concerned.

In Sudsnik the body is always JSON, and what shape of JSON is allowed is written down rather than implied
([`03-apis-and-endpoints.md`](03-apis-and-endpoints.md)). `curl -i` prints the response headers as well as the body, which is how you see
the status code. Use it while you are learning and drop it later.

## 2. Get a token

Sudsnik is multi-tenant: four operators, three habitats each (`docs/system-spec.md` §2.2). The public API wants
to know which operator you are, so the first request gets a token from the `identity` provider:

```sh
curl -s -i -X POST http://127.0.0.1:4102/token \
  -H 'content-type: application/json' \
  -H 'X-Sudsnik-Tenant: op1' \
  -d '{"operatorId":"op1","key":"key1"}'
```

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8
content-length: 75
Date: Mon, 21 Sep 2026 23:55:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"token":"tok_op1_71d4eff72fb2","operatorId":"op1","expiresAtMs":540120000}
```

The token string and `expiresAtMs` differ on every call, so keep the one you get:

```sh
TOK=$(curl -s -X POST http://127.0.0.1:4102/token -H 'content-type: application/json' \
  -H 'X-Sudsnik-Tenant: op1' -d '{"operatorId":"op1","key":"key1"}' \
  | sed 's/.*"token":"\([^"]*\)".*/\1/')
```

## 3. Place an order

Every response from here on is shown without its `Date`, `Connection` and `Keep-Alive` header lines, which curl
does print and which say nothing.

Without the token first, to see what a refusal looks like:

```sh
curl -s -i -X POST http://127.0.0.1:4000/v1/orders \
  -H 'content-type: application/json' -H 'Idempotency-Key: primer-a' \
  -d '{"habitatId":"hab01","podId":"hab01-p001"}'
```

```
HTTP/1.1 401 Unauthorized
x-correlation-id: 01M336AQ1KWWY14APV2SQFE46Z
content-type: application/json; charset=utf-8
content-length: 149

{"code":"UNAUTHORIZED","message":"missing or malformed Authorization: Bearer <token>","retryable":false,"correlationId":"01M336AQ1KWWY14APV2SQFE46Z"}
```

Now with it:

```sh
curl -s -i -X POST http://127.0.0.1:4000/v1/orders \
  -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' -H 'Idempotency-Key: primer-a' \
  -d '{"habitatId":"hab01","podId":"hab01-p001"}'
```

```
HTTP/1.1 201 Created
x-correlation-id: 01M336AQ1ZJ5D2DRYFWP5T1NFF
content-type: application/json; charset=utf-8
content-length: 172

{"orderId":"01M336AQ2H2QKEF447WZC4V6VV","tenantId":"op1","habitatId":"hab01","podId":"hab01-p001","state":"placed","payment":"pending","placedAt":120000,"updatedAt":120000}
```

Four things in that response vary and one is worth knowing why. `orderId` is a fresh ULID. `x-correlation-id`
is a fresh id for this request, and it is stamped on every log line and trace span the request touches. `placedAt`
is simulated milliseconds since the simulator started, not a wall clock, so yours depends on how long your stack
has been up. And `payment` is `"pending"` because `billing` is not running: `orders` places the order anyway and
leaves payment for later, which is what a system that degrades rather than fails looks like.

## 4. Status codes

Read the first digit first. `2xx` it worked, `4xx` you asked wrongly, `5xx` it broke. The exact codes Sudsnik
uses are fixed by a single table, `ErrorCode` in `packages/kernel/src/errors.ts`, listed in
`docs/system-spec.md` §5.5. Three more of them, on the same route:

```sh
curl -s -i "http://127.0.0.1:4000/v1/orders/01ABC" -H "Authorization: Bearer $TOK"
curl -s -i -X POST http://127.0.0.1:4000/v1/orders -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' -H 'Idempotency-Key: primer-b' -d '{"habitatId":"hab01"}'
curl -s -i -X POST http://127.0.0.1:4000/v1/orders -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' -H 'Idempotency-Key: primer-c' \
  -d '{"habitatId":"hab04","podId":"hab04-p001"}'
```

Bodies only, with the headers cut:

```
HTTP/1.1 404 Not Found
{"code":"NOT_FOUND","message":"no order 01ABC","retryable":false,"correlationId":"01M336AQ46YRWEBG6V18VJFYTY"}

HTTP/1.1 400 Bad Request
{"code":"INVALID","message":"body/podId Invalid input: expected string, received undefined","retryable":false,"correlationId":"01M336AQ4KRYS8CAX4SW734QBG"}

HTTP/1.1 403 Forbidden
{"code":"FORBIDDEN","message":"habitat hab04 is not operated by op1","retryable":false,"correlationId":"01M336AQ50HEDRBTQVW4T46VBV"}
```

Every error body has the same four fields. `retryable` is the interesting one: it is the service telling its
caller whether trying again could possibly help. None of these three would be helped by trying again, and the
field says so.

## 5. Idempotency

`Idempotency-Key` is a header you choose, and it means "if you have already done this one, do not do it again".
Send the same request twice with the same key:

```sh
curl -s -i -X POST http://127.0.0.1:4000/v1/orders -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' -H 'Idempotency-Key: primer-a' \
  -d '{"habitatId":"hab01","podId":"hab01-p001"}'
```

The second response has the same body as the first, same `orderId` and all, and there is still one order. If you
send it to `orders` directly rather than through `gateway`, on port 4001 with `-H 'X-Sudsnik-Tenant: op1'` in
place of the token, the replayed response also carries a header saying so:

```
HTTP/1.1 201 Created
x-correlation-id: 01M336C1KRHG9B4PC6396EPWXQ
idempotent-replayed: true
```

This matters because networks lose responses, not just requests. A client that did not hear back cannot tell a
request that failed from one that succeeded silently, so its only safe move is to send it again. Every write
route in Sudsnik requires the header, enforced by a lint rule (`docs/system-spec.md` §5.4).

## 6. Exercise

Pick a pod nobody has used, say `hab02-p077`, and send the same body three times: once with
`Idempotency-Key: mine-1`, once more with `mine-1`, and once with `mine-2`. Write down what you expect each
status code to be before you send it.

The third one answers 409, and its `message` names the pod. Then count the orders that exist for that pod:

```sh
curl -s "http://127.0.0.1:4000/v1/orders?habitatId=hab02" -H "Authorization: Bearer $TOK" \
  | grep -o '"podId":"hab02-p077"' | wc -l
```

It prints 1. Now say why the second request and the third request got different answers although the
bodies were identical, and which of the two protects you from a lost response and which from a second customer.
