# Tests

Page 8 of the primer. You need the repository, not the running stack; stop it if you like.

## 1. What the suite is

Vitest is the runner. Tests live in a `test/` directory beside the `src/` they test, and each package with one is
its own vitest project, named after the package (`vitest.config.ts`). Nothing in the suite goes over the network:
a test builds the service's Fastify app and calls `app.inject`, which runs a request through the whole app
without a socket (`docs/system-spec.md` §5.1, rule 10).

That is why the suite is worth running while you work. It is fast enough to run on every save, and it exercises
routing, schema validation, the database and the handlers, which is most of what you can get wrong.

## 2. Run it

```sh
npm test
```

The last lines:

```
 Test Files  70 passed (70)
      Tests  481 passed | 2 skipped (483)
   Start at  16:54:00
   Duration  7.25s (transform 16.76s, setup 0ms, collect 73.26s, tests 16.56s, environment 10ms, prepare 6.69s)
```

Those counts are this tree as it stands, and will move as you add tests of your own. The durations are yours.

Run one package's project instead, which is what you will do all term:

```sh
npx vitest run --project orders
```

```
 RUN  v3.2.7 /path/to/your/checkout

 ✓ |orders| test/public/compensation.test.ts (2 tests | 1 skipped) 148ms
 ✓ |orders| test/contract/contract.test.ts (6 tests) 156ms
 ✓ |orders| test/public/read.test.ts (4 tests) 188ms
 ✓ |orders| test/public/place.test.ts (9 tests) 235ms

 Test Files  4 passed (4)
      Tests  20 passed | 1 skipped (21)
   Duration  913ms (transform 283ms, setup 0ms, collect 1.88s, tests 726ms, environment 0ms, prepare 234ms)
```

The path on the `RUN` line is your checkout's, and the `Start at` line is cut here.

Two directories, two jobs. `packages/services/orders/test/contract/` checks the service against the contract in
`packages/contracts`, so it would pass against any correct implementation of the port.
`packages/services/orders/test/public/` checks this implementation.

## 3. Break something

Open `packages/services/orders/src/core/OrdersService.ts` and find where a new order is built. Line 84 is:

```ts
      state: "placed",
```

Change it to `"scheduled"` and run `npx vitest run --project orders` again. Trimmed to the second failure and
the counts:

```
 FAIL  |orders| test/public/read.test.ts > list > is tenant-scoped and filters by state and habitat
AssertionError: expected [] to deeply equal [ '01M33691F9CHCM6F5FV9RXYVXK', …(1) ]

- Expected
+ Received

- [
-   "01M33691F9CHCM6F5FV9RXYVXK",
-   "01M33691FBWV18B1RYWEDJ667A",
- ]
+ []

 ❯ test/public/read.test.ts:40:65
     38|     await place(stack.app, { habitatId: "hab04", podId: "hab04-p001" }…
     39|     expect((await list("")).map((o) => o.orderId)).toEqual([a.orderId,…
     40|     expect((await list("?state=placed")).map((o) => o.orderId)).toEqua…
       |                                                                 ^

 Test Files  2 failed | 2 passed (4)
      Tests  2 failed | 18 passed | 1 skipped (21)
```

The ids are fresh on every run and yours will differ. The shape of the output will not: the test's name, the
values compared, the line, and the source around it.

Two tests failed, in two files. One of them is the obvious one, in `place.test.ts`, which asserts the whole
placed order. The other is in `read.test.ts` and is about filtering a list by state; its author was not thinking
about placement at all. That is the thing to notice. A one-word change was caught twice, and the second catch is
the one that tells you the change had consequences you had not considered. Put the line back and confirm the
project is green again before you go on.

## 4. What these tests are for here

Three of them, and they are different jobs.

A test can be a specification, written before the code, saying what the thing must do. A `test/contract/`
directory is this.

A test can be a description, written after the code, saying what the thing currently does. That is a
characterization test, and it is how you take over somebody else's component: you write down what it does now so
that you can tell what your change altered. Week 1 asks for these.

A test can be a trap, left where a mistake would land. The failure you just caused is one.

None of the three is checking that the code is right. They check that it still does what somebody once decided
it should. Whether that was the right decision is a different question, and the only way to answer it is to read
the contract.

## 5. Exercise

Run `npx vitest run --project washnodes`. It reports `Tests 33 passed | 1 skipped (34)` in this tree.

Then, without touching any test file, make exactly one test in
`packages/services/orders/test/public/place.test.ts` fail by changing one line under
`packages/services/orders/src/`. You are aiming for `Tests 1 failed`, not two and not nine, so read the tests
first and pick a line only one of them can see. Write down the line and the test you expect before you run it.

Put the line back, confirm `npx vitest run --project orders` is green and `git diff` is empty, and then say why
the change you made was the only one of the three you considered that stayed inside one test.
