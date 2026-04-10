# support

Pod anomaly reports in free text, triaged into `{ category, severity, action }` by a `TriageWorkflow`, with escalation on request (`docs/system-spec.md` §9.10).

Routes: `POST /reports` stores a report, publishes `anomaly.reported`, and triages it in the same request; `GET /reports/:id`; `POST /reports/:id/triage` re-runs triage on demand and publishes `triage.completed`; `POST /reports/:id/escalate` marks it `escalated`. Consumes `order.returned` (recorded), `wash.faulted` (opens a report `washer <washerId> fault <faultCode>`), `notification.failed` (recorded). Every handler dedupes on the envelope id.

Tables (`support.sqlite`, `migrations/`): `reports`, `triage_results` (append-only; `reports.triage_id` names the current one), `orders_seen`, `notification_failures`, `eval_fixtures` (the copy the eval scores from), `handled_events` (dedupe), `token_usage` (tokens per orbit, which nothing spends), plus the infra outbox.

Triage is a table of cues (`src/workflow/keywords.ts`) tried against the note in order. The first cue that matches names the category, and the severity where that cue carries one, otherwise the category's default; a note no cue matches is `other`. A second list then raises the severity where the note asks for it, never lowers it, and the action follows from the category, the severity, and the note. Nothing is asked of a provider, so a triage reports `tokens: 0` and `guarded: false`.

Layout: `src/workflow/` holds the cue table and `validate.ts` (the triage field set and the parser that reads them out of a completion); `src/variants/keywords/` composes the workflow and `src/index.ts` selects it; `src/service.ts` is the port over `src/store.ts`; `src/routes.ts` the routes; `src/handlers/` the consumers, reaching the app through `src/handlerContext.ts`; `src/eval/` the eval runner; `src/schema.ts` the Drizzle tables; `src/app.ts` wires them.

`npm run eval [-- --set triage|hostile|all]` runs the workflow over the oracle fixtures against the in-process mock and prints precision and recall per set.
