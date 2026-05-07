# Caches

Page 5 of the primer. The stack is running and you have a token ([`02-http.md` §2](02-http.md)).

## 1. What a cache is and what it costs

A cache keeps the answer to a question you have already asked, so that asking again is cheap. That is the whole
idea. Everything difficult about caches is in the second sentence: the kept answer can be wrong by the time you
use it, and you have to decide how wrong you can stand.

A cache is fixed by three choices. What the key is. How long an entry lives, its time to live. What happens when
it is full, its eviction policy. Sudsnik's is `createCache` in `packages/infra/cache/src/index.ts`, an
in-process map with a maximum size and a TTL taken from the simulated clock.

## 2. Watching one work

Every service reports what it has spent at `/cost`, priced in canon units per operation
(`docs/system-spec.md` §2.2). A cache read costs 4 units; a call out to an external provider costs 128. That
ratio is why caches exist, and `/cost` lets you measure it rather than assume it.

`gateway` caches one thing: what the `identity` provider said about a token, for ten simulated minutes
(`packages/services/gateway/src/verify.ts`). Ask what `gateway` has spent so far:

```sh
curl -s http://127.0.0.1:4000/cost | jq '{totalUnits, byOperation}'
```

```json
{
  "totalUnits": 1822,
  "byOperation": {
    "CONNECTION": {
      "count": 4,
      "units": 1024
    },
    "DB_WRITE": {
      "count": 8,
      "units": 120
    },
    "CACHE_READ": {
      "count": 8,
      "units": 32
    },
    "EXTERNAL_CALL": {
      "count": 1,
      "units": 128
    },
    "CACHE_WRITE": {
      "count": 1,
      "units": 6
    },
    "INTERNAL_CALL": {
      "count": 8,
      "units": 512
    }
  }
}
```

Your absolute numbers will not match mine, because they count everything that has gone through `gateway` since
the stack started. The differences are the point. Take the `orderId` you placed on [`02-http.md` §3](02-http.md), send three
more requests on the same token in one command, then ask again:

```sh
ORDER=01M336AQ2H2QKEF447WZC4V6VV      # yours, from the 201 on 02-http.md §3
for i in 1 2 3; do
  curl -s -o /dev/null "http://127.0.0.1:4000/v1/orders/$ORDER" -H "Authorization: Bearer $TOK"
done
curl -s http://127.0.0.1:4000/cost | jq '{totalUnits, byOperation}'
```

```json
{
  "totalUnits": 2026,
  "byOperation": {
    "CONNECTION": {
      "count": 4,
      "units": 1024
    },
    "DB_WRITE": {
      "count": 8,
      "units": 120
    },
    "CACHE_READ": {
      "count": 11,
      "units": 44
    },
    "EXTERNAL_CALL": {
      "count": 1,
      "units": 128
    },
    "CACHE_WRITE": {
      "count": 1,
      "units": 6
    },
    "INTERNAL_CALL": {
      "count": 11,
      "units": 704
    }
  }
}
```

Three requests, three more `CACHE_READ`, three more `INTERNAL_CALL`, and `EXTERNAL_CALL` and `CACHE_WRITE` both
where they were. `gateway` asked `identity` about your token once, when it first saw it, and answered the other
three from memory. Three external calls saved, at 128 units each, for 12 units of cache reads.

## 3. TTL is shorter than you think

Do the same three requests one at a time, with four seconds between them, and `CACHE_READ` goes up by three as
before, but so do `EXTERNAL_CALL` and `CACHE_WRITE`. Every one of the three missed, went to `identity`, and
wrote the answer down again.

The entry lives ten simulated minutes. The simulated clock runs at 600 times wall time
(`docs/system-spec.md` §2.2), so ten simulated minutes is one second of yours. A `for` loop gets all three
inside it. Your fingers do not.

That is worth more than the cache lesson. Every duration in this system is on the simulated clock: hold
expiries, visibility timeouts, retry backoffs, the lot. Reading one as though it were wall time will make you
wrong about what you just saw, in both directions.

## 4. A part that is not free

Everything a cache saves it buys with staleness. `gateway` remembers what `identity` said for ten simulated
minutes, so a token revoked inside that window keeps working until the entry expires. That is a deliberate
trade, and the argument for it is that revocation is rare and verification is on every single request.

The pair of numbers to have an opinion about is always the same. How much does the cache save, which `/cost`
will tell you. How wrong can the answer be, which is the TTL, and which only you can decide.

## 5. Exercise

Fetch a second token for `op1` exactly as in [`02-http.md` §2](02-http.md), keeping the first. Then, reading `/cost` before
and after each step, predict the change in `EXTERNAL_CALL`, `CACHE_WRITE` and `CACHE_READ` for each of:

1. one request with the new token;
2. a second request with the new token, sent in the same command as the first;
3. a third request with the new token, sent five seconds later.

Write all nine numbers down before you run anything. Then, for whichever prediction you got wrong, find the
three lines of `packages/services/gateway/src/verify.ts` that decide it and say which of the three you had
misread.
