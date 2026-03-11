# oracle

Fixture-backed completion service standing in for an LLM; it never calls a model. Every request needs `X-Sudsnik-Tenant`; `/_sim/*` does not.

| Endpoint | Behavior |
|---|---|
| `POST /complete` | Body `{ prompt, maxTokens }`. `{ completion, promptTokens, completionTokens, fixture? }`. |
| `GET /usage` | `{ byTenant: { <tenant>: { promptTokens, completionTokens, calls } } }` over every call so far. |
| `GET /_sim/stats` | `{ quotaRefusals: { total, byTenant } }`, counted over the whole run and never reset by `/_sim/state`. |

- The completion is that of the first fixture whose normalized `note` (trimmed, whitespace collapsed, lowercased) occurs in the normalized prompt; `fixture` names it as `<set>/<n>`. A prompt matching no fixture gets `REFUSAL_COMPLETION` from `contracts/src/mocks/oracle.ts` and no `fixture`.
- Tokens are counted as whitespace-separated words times 1.3, rounded; a completion longer than `maxTokens` is cut to the words that fit.
- Fixtures live in `fixtures/triage` (60) and `fixtures/hostile` (30), one `<n>.json` each in the `Fixture` shape. Hostile notes embed instructions and their `completion` is the naive, injected answer (`action: clean`); `expected` stays the correct one, so a guarded caller must catch the injection.
