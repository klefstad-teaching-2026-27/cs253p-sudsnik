# TypeScript for people who know another language

Page 10 of the primer. You need the repository, not the running stack.

This is not a tour of the language. It is the four things that will trip you up if you arrive from Java, Python,
Go, C# or Rust, and the three conventions this repository adds on top.

## 1. Four things that are not like your language

**Types are gone at runtime.** TypeScript is JavaScript plus annotations that a compiler checks and then erases.
There is no `instanceof MyInterface`, no reflection over a type, no runtime cost and no runtime protection.
Everything arriving from outside the process is `unknown` until something checks it, which is §2.

**Typing is structural.** A value fits a type if it has the right shape. Nothing has to declare that it
implements anything. `OrdersService` in `packages/contracts/src/services/orders/port.ts` is an interface, and the
class that satisfies it never names it.

**Unions and literal types are the main modelling tool.** `OrderState` is not an enum class; it is the union of
nine string literals, built from one array in
`packages/contracts/src/services/orders/routes.ts`. A variable of that type can hold `"placed"` and cannot hold
`"queued"`, and the compiler knows which branches of a `switch` you have not written.

**Strictness is on.** `strict` in `tsconfig.base.json` means, among other things, that `T` and `T | undefined`
are different types and the compiler will not let you confuse them. If you have written TypeScript before
without `strict`, this is a different language.

## 2. Three conventions of this repository

**Errors are values, not throws.** `Result<T, E>` in `packages/kernel/src/result.ts` is a two-case union:

```ts
export type Result<T, E = SudsnikError> = { ok: true; value: T } | { ok: false; error: E };
```

A service method returns `Promise<Result<Order>>`. The caller cannot use the `Order` without first narrowing on
`ok`, so there is no way to forget the failure case, and no exception crosses a service boundary
(`docs/system-spec.md` §5.5).

**The edge is checked with zod.** A schema is a value that both describes a type and validates data, and the
TypeScript type is derived from it rather than written twice. That is why the routes on
[`03-apis-and-endpoints.md` §1](03-apis-and-endpoints.md) carry their schemas: one definition produces the compile-time type, the runtime
check, and the OpenAPI document.

**Everything a service needs is handed to it.** Clock, bus, meter, flags, clients, telemetry, all arrive as
`deps` (`docs/system-spec.md` §5.5, `ServiceDeps`). No module-level singletons, no imports of other services.
That is what lets a test build a whole service over fakes and run it in a millisecond.

## 3. A compiler is a check you run

```sh
npm run typecheck
```

It echoes the two lines npm always echoes, says nothing else, and exits 0. Now open
`packages/services/orders/src/core/OrdersService.ts`, change line 84 from
`state: "placed"` to `state: "queued"`, and run it again:

```
packages/services/orders/src/core/OrdersService.ts(84,7): error TS2322: Type '"queued"' is not assignable to type '"collected" | "delivered" | "returned" | "washing" | "scheduled" | "cancelled" | "placed" | "washed" | "returning"'.
```

Nine states, listed, from a definition three packages away. Nobody wrote that check either.

Put the line back.

## 4. What types cannot check, the lint rules do

Some of this system's rules are about where a value comes from rather than what shape it is, and a type cannot
express them. Those are ESLint rules in `tools/lint`, listed in `docs/system-spec.md` §5.4. Try one. Line 78 of
the same file is:

```ts
    const now = this.deps.clock.now();
```

Change it to `const now = Date.now();` and run:

```sh
npm run lint
```

```
/your/checkout/packages/services/orders/src/core/OrdersService.ts
  78:17  error  Date.now() reads the wall clock; use deps.clock.now()  sudsnik/no-wall-clock

✖ 1 problem (1 error, 0 warnings)
```

The first line is the absolute path of your own checkout. `Date.now()` type-checks perfectly. It is still wrong
here, because every duration in Sudsnik is on the simulated clock ([`05-caches.md` §3](05-caches.md)) and a run that reads the
wall clock is not reproducible. `AGENTS.md` lists the five rules that get broken by anyone, human or model, who
was not told about them.

Put the line back and confirm `git diff` is empty.

## 5. Exercise

In `packages/services/orders/src/core/OrdersService.ts`, find the `place` method. It ends with `return ok(order)`.

1. Change it to `return order` and run `npm run typecheck`. You get one `TS2322` naming a very long pair of
   types. Say in your own words what the compiler thinks the method promised.
2. Put it back. Now find any caller of a method that returns a `Result` and try to use the value without
   checking `ok` first. The error you get names two types; say which one is which.
3. Without running anything: `Result<T>` defaults `E` to `SudsnikError`. Open `packages/kernel/src/errors.ts`.
   Nine error codes, and `retryable` is not a field anybody sets by hand. Name the three codes it is `true` for,
   and say what the three have in common that the other six do not. All three errors on [`02-http.md` §4](02-http.md) came
   back `false`; say why that was the right answer for each of them.

Put every line back. `npm run typecheck`, `npm run lint` and `npm test` are all green in this tree as it stands,
so anything red at the end of this page is yours.
