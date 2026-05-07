# Sudsnik autograder specification

Functional specification of the release train and its implementation in [raygun](https://github.com/vvinhtran/zot-raygun). Written for the agents and engineers who build it. The system it grades is in `system-spec.md`; grading weights and writing rules are the instructor's own documents.

## 1. Scope

A submission is a release candidate. The grader runs it through a pipeline modeled on a deployment and returns a deploy log (§8), not a list of test names. The same driver, `apps/release`, runs locally under `npm run release` and inside the grader, producing the same log format.

## 2. Pipeline stages

| Stage | What runs | Failure modes | What the student sees |
|---|---|---|---|
| Intake | Layout, boundary, required files | Files outside the seam; a required file missing | Rejection with the offending paths |
| Build | `tsc --noEmit`; house lint (`system-spec.md §5.4`); public tests | Type errors; lint violations; failing public tests | Full compiler and lint output; vitest results |
| Contract gate | Hidden contract tests for the seam | Port mismatch; undeclared topic published or consumed; non-idempotent handler | Test names and assertion messages |
| Canary | Single-process boot under the grader environment (§3) and the process environment it fixes; `/ready` within the readiness deadline the grader environment fixes; `quiet-orbit` at scale 1 with the public seed and known faults | Boot crash; `/ready` before migrations; slow start; ungraceful shutdown losing in-flight orders | The deploy log (§8) as the stage row's text: findings, the outage if any, incident lines, one row per item; on a boot failure, the tail of the boot log |
| Production | Same boot; the week's scenario (`system-spec.md §10`) at the assignment's scale with the team seed and the hidden fault draw | Everything above plus partitions, duplicates, out-of-order callbacks, quota exhaustion, bit flips, peak load | Incident timeline (alerts fired, SLO breaches, stuck orders); the same logs and reports; band scores. Fault schedule hidden until the due date |
| Report | One weighted test per invariant and two per band, `<band>.half` and `<band>.full` (§7.1); summary line (§8.2) | none | Score; both deploy logs in their rows' text |

Everything except the production fault schedule is visible immediately.

## 3. Grader environment

The grader differs from the laptop in these ways, each documented in [`docs/runbooks/grader-environment.md`](runbooks/grader-environment.md) in the student tree:

1. ports and data directories come from environment variables (`system-spec.md §5.3`), not defaults;
2. the working tree is read-only except `SUDSNIK_DATA_DIR`;
3. `NODE_ENV=production`, which disables permissive CORS and unauthenticated `/cost`;
4. `contracts` is the pinned golden version, which is one minor ahead of the starter's when the assignment intends a compatibility lesson;
5. `SIGTERM` arrives at the end of the run and in-flight orders are counted;
6. memory: the whole container has the cgroup its Autograder Settings give it, 1536 MB, and the same cap under `raygun test --docker`; the student process runs with the heap cap `NODE_HEAP_MB` in `plugins/sudsnik.py` names and the highest `oom_score_adj`, so the kernel's memory killer chooses it before the simulator or the mocks; no address-space limit applies, since Node cannot start under one small enough to matter; the build stage runs before the stack is up;
7. a scenario that names `restartAtOrbit` (`system-spec.md §10`) has the stack stopped and started again mid-run on the same data directory;
8. the simulator's control surface takes `SUDSNIK_SIM_TOKEN`, which the stack does not have (`system-spec.md §7`).

## 7. Scoring

### 7.1 Invariants and bands

Each canary and production run emits `TestResult`s per the table below, one per row of the deploy log's `results.items` (§8.1), which the driver produces in `scoreItems` in `apps/release/src/driver.ts` and which nothing else re-derives. Invariant items are one pass-or-fail test each. Band items are two tests of equal weight, `<band>.half` and `<band>.full`; a half score is one passed test (raygun scores a test as all or nothing). Thresholds are calibrated in §7.2. A band of a stage whose row in `bands.yaml` is empty is one passing test of the band's whole weight instead, with `<band>` as its id, the shape `turnaround` takes in a scenario that does not measure it: both ends were measured, neither separated, and no submission moves a band that measures nothing. Band items never exceed one third of any stage's points. A cost band (`units`, `tokens_per_10k`) scores nothing in a stage where a scenario invariant failed: a seam that spends nothing while its work is undone has shown absence, not efficiency.

Weights are the constants of `scoreItems`, scaled to the group's points when the grader names them (`--points`). `p95` and `units` are graded in every scenario. `turnaround` is graded where the scenario declares it: a scenario overloaded by design (`laundry-day` at scale) misses the SLO for reasons that are not the submission's. Where it does not, that weight goes to the bands the scenario declares instead, split evenly between them: `storm` measures time to detect and dead letters, `hostile-notes` eval precision, eval recall, and tokens per 10k, and those are what Weeks 6 and 7 are about. A scenario declaring none of its own keeps the weight rather than losing it, so every stage totals the same points whatever its scenario measures:

| Item | Canary (30) | Production (50) |
|---|---|---|
| `lost_on_drain` | 10 | 10 |
| `tenant_leak` | 4 | 5 |
| `undeclared_topic` | 4 | 5 |
| Scenario invariants, split evenly | 6 | 15 |
| `turnaround`, or the scenario's own bands split evenly, half the weight per row | 2 | 5 |
| `p95` | 2 | 5 |
| `units` | 2 | 5 |

Week 7 splits production into two groups of 25 with the production column halved.

| Item | Type | Source |
|---|---|---|
| No order lost on `SIGTERM` | Invariant | After the stack exits, the driver opens `orders.sqlite` read-only and compares with its placed list (`system-spec.md §10.2`) |
| Turnaround SLO met | Band | As `system-spec.md §10.2` defines turnaround |
| Placement p95 | Band | Wall-clock spans named `http POST /v1/orders` |
| Units per 10k orders | Band | The `/cost` of every service the submission replaces, normalized by orders placed. The system total is reported beside it as `units_system` and is not graded, since eight services the student did not write dilute one seam's waste |
| Scenario-specific invariants (`system-spec.md §10`) | Invariant | `oracle.json` written by the simulator (`system-spec.md §10.2`) |
| Scenario-specific bands (`system-spec.md §10`) | Band | `oracle.json`, except `dead_letters`, which the driver counts in the bus file |
| Undeclared topic used | Invariant | The `topic_use(service, topic, direction, count)` table in the bus file, read after drain |
| Tenant leak | Invariant | Any response or event carrying another tenant's id |

### 7.2 Calibration

Bands are set from the samples every deploy assignment ships. The golden variant and the naive variant are the two measured ends, except for a band that measures what the week's work adds over what the student inherited, `eval_precision` and `eval_recall`, whose worse end is the variant the starter ships and whose thresholds record it as `worseVariant`. Full credit begins at the midpoint between them, and half credit at the midpoint of what remains; the worse end's figure is the zero end. Matching the reference implementation is not the bar a student has to clear: being closer to it than to waste is. Recalibrate whenever canon numbers or the golden variant change.

| Measured or derived | Value |
|---|---|
| `golden` | the golden variant's figure, measured, recorded unrounded |
| `naive` | the worse end's figure, measured, recorded unrounded |
| `full` | midpoint of `golden` and `naive`, rounded |
| `half` | midpoint of the rounded `full` and the rounded `zero`, rounded |
| `zero` | `naive`, rounded |

A published threshold is coarse, and rounds away from strictness in the direction the band is read. `units` varies about 0.2% between idle runs and about 12% under load, so eight significant figures state a precision no run has; coarse thresholds survive a remeasurement, which keeps the emitted assignment trees byte-stable across one; and `2 * full - zero` no longer recovers the golden figure the starter's copy of the file is narrowed to withhold. No rounding makes a threshold harder to meet than the measurement made it.

| Direction | `full` is | Rounded |
|---|---|---|
| `lowerIsBetter: true` (`units`, `tokens_per_10k`) | a ceiling | up, to two significant figures |
| `lowerIsBetter: false` (`eval_precision`, `eval_recall`) | a floor | down, to two decimal places |

`half` is derived from the rounded `full` and the rounded `zero` rather than from the raw midpoint, which holds `full` ≤ `half` ≤ `zero` for a cost band and the reverse for the others; rounding the three apart can invert or collapse them. `roundThreshold` and `thresholdsFrom`, in the golden tree's calibration, are where the rule lives.

Calibration runs in the golden tree rather than in the assignment, which ships one variant of a seam and not both. `npm run calibrate` runs each graded stage's scenario with the submission's services golden and once more with them naive, and a third time with the starter variant where a band's worse end is the starter, and writes `tools/fixtures/bands.yaml`. A run is what a scenario, a scale, a seam set, and the variant those seams are swapped to name together, and each distinct run is made once however many rows read it: a golden run records every service's own units, so one serves every row on that scenario and scale, and one naive run serves every row swapping the same seams there. Every week's canary is `quiet-orbit` at scale 1 (§2) and Weeks 2, 3, and 8 submit `billing` there, so five rows are measured from one naive `billing` run. Measuring the same thing twice costs minutes and answers differently each time, which is a worse answer than measuring it once; naming an assignment (`npm run calibrate -- wk4-washnodes`) measures both of its stages and merges them into the file, and naming one row (`npm run calibrate -- wk4-washnodes/canary`) measures that stage alone, which is what remeasuring one stage takes when the other's figures are to stay as they were. The file is shaped `{ <row>: { <band>: { full, half, zero, lowerIsBetter, golden, naive, worseVariant? } } }`, `naive` being the worse end's figure and `worseVariant` naming the starter variant where that is what was measured; the two measured ends are recorded beside the thresholds so the derivation can be checked without rerunning, which is the instructor's copy of the file; the starter's carries the four keys a run is scored against and none of the three. The file is pinned into the assignment as `fixtures/bands.yaml` when the grader is packed, and is generated, never edited.

Thresholds are keyed by assignment and stage rather than by scenario, since weeks share `quiet-orbit` with different seams. A week's two graded stages are two different runs: every canary is `quiet-orbit` at scale 1 over the seams that stage submits (§2), where production runs the week's own scenario at its own scale, and for Week 8 over a wider seam set. A row measured on one cannot judge the other, so the canary has a row of its own, keyed `<assignment>/canary`. Production keeps the bare `<assignment>`, which is also the row a stage with none of its own is judged by; `thresholdsFor` in `apps/release/src/bands.ts` resolves the two, and `TARGETS` in the golden tree's calibration holds one entry per row. Weeks 1 and 3 run `quiet-orbit` at scale 1 in production too, over the seams their canary submits, so each week's two rows are the one run read twice and carry identical figures. Week 2's production run switches `billing` off and the seam spends nothing, so its row never binds; the row that judges the week's work is the canary's.

A cost band that separates golden from its worse end by less than two, or a band on a 0 to 1 scale by less than a tenth (`MIN_SEPARATION` and `MIN_GAP` in that same calibration), is not written. The separation is taken on the two measured ends and never on the rounded thresholds, which stops coarse rounding making a band look separable when it is not. A stage whose row holds other bands scores an unwritten one at half. A stage that wrote no band at all keeps an empty row rather than none: the empty row stops the stage falling back on the run the other stage made, and each of its bands keeps its whole weight as one passed row (§7.1). `wk7-support/canary` is the one such row (`support`'s two ends are 1.16x apart on `quiet-orbit`, where the week's work shows on `hostile-notes`), and a Week 7 canary therefore totals its 30 points without it. A band that narrow moves a grade on noise, and a band whose naive end is the cheaper one grades backwards. The answer is a naive variant that is wasteful on the path the scenario actually drives, or less weight on the band, never a hand-picked threshold.

Until a stage is calibrated, `apps/release` awards its bands half credit: a stage with no row in the file, which is every local run and what `thresholdsFor` returns nothing for, has no measured threshold to judge them by. Guessing a threshold would move a student's grade against a number nobody measured. A stage whose row is there and empty is the other case above, and keeps the weight. `turnaround` and `p95` are not calibrated at all: their thresholds are the canon SLOs of `system-spec.md` §2.2, and `bands.yaml` holds the measured ones. `dead_letters` and `time_to_detect` have natural scales rather than calibrated ones: full credit at no dead letter and half up to the count `DEAD_LETTERS_BAND` in `apps/release/src/driver.ts` names; full credit for a detection within the orbit the fault landed in and half within the three orbits that make an order stuck, the minutes `TIME_TO_DETECT_BAND` names. The starter ships no alert rule, so the starter end of `time_to_detect` cannot be measured. `npm run calibrate` measures a band whose better end is the higher number, `eval_precision` and `eval_recall`, against the starter end.

A band the run could not measure is a different case and scores nothing. Absent and perfect must never be the same answer: a submission whose trace file or `/cost` never appeared has demonstrated nothing, and the deploy log leaves that band out rather than reporting the zero a missing file and a flawless run would share (`system-spec.md §10.2`).

## 8. Deploy log

### 8.1 Format

`deploy-log.json`, one per run, plus a rendered `deploy-log.txt`:

```
{
  "run": {"assignment": "wk3-billing", "seed": "public|team", "scenario": "quiet-orbit", "scale": 1, "clockRate": 600, "startedAt": "...", "contractsVersion": "1.4.0"},
  "stages": [
    {"stage": "intake|build|contract|canary|production",
     "status": "passed|failed|skipped",
     "durationMs": 0,
     "findings": [{"severity": "error|warn|info", "code": "READY_TIMEOUT", "message": "...", "at": "service:orders", "excerpt": "..."}],
     "artifacts": ["logs/orders.jsonl", "otel/trace.jsonl", "cost.json"],
     "restartDownMs": 116}
  ],
  "incident": {"alerts": [{"atMs": 0, "rule": "...", "service": "..."}], "sloBreaches": [{"slo": "...", "observed": 0, "target": 0}], "stuckOrders": [{"orderId": "...", "state": "...", "sinceOrbit": 0}], "deadLetters": 0, "lostOnDrain": 0},
  "score": {"public": 0, "contract": 20, "canary": 30, "production": 50, "total": 100},
  "results": {"invariants": {"lost_on_drain": {"pass": true, "detail": "..."}}, "bands": {"p95": 12}, "unitsByService": {"billing": 0},
              "items": [{"id": "lost_on_drain", "weight": 10, "passed": true, "detail": "..."}, {"id": "units.half", "weight": 2.5, "passed": true, "detail": "..."}]},
  "signature": "hex(HMAC-SHA256(LEDGER_KEY, canonical JSON of run, incident, and score))"
}
```

`results.items` are the stage's graded rows (§7.1): weights sum to the stage's points, and the stage score is the sum of the passed rows. `restartDownMs` is present where the scenario asked for a restart (`system-spec.md §10`) and the stack came back, and is how long it was down. Artifact paths are relative to `results/`. The driver copies the trace and the logs a finding cites there from the data directory, which under the grader is scratch and goes with the run; an artifact that was never written is not named. `run.startedAt` is wall-clock ISO 8601. `run.contractsVersion` is read from the staged golden `contracts/package.json`. `run.clockRate` is the virtual-clock multiplier the run drove at, which is `SUDSNIK_CLOCK_RATE` (`system-spec.md §5.3`) and the canon rate (`system-spec.md §2.2`) where nothing set it: a run at any other rate reaches the same verdicts but different bands, and this field is the only thing that still says so once the terminal that printed the banner is closed. The rendered header carries it as `clock=`. The `signature` is what a group postmortem cites, and it covers `run`, so a log cannot be moved from one rate to another.

A reader of a deploy log takes the fields it knows and ignores the rest: `run` grows a field when a run grows a way of differing from the canon one, and a reader that rejects an unknown key would reject every log written after it.

Finding codes are an enumerated list in `apps/release/src/codes.ts`; every code has an entry in [`docs/runbooks/deploy-log.md`](runbooks/deploy-log.md), which the student tree ships, and a test in `apps/release` holds the two to parity.

The finding codes are the keys of `FINDING_CODES` in `apps/release/src/codes.ts`, each with one line saying what it means; `RUN_DEADLINE` is the one a run that could not finish reports, and the run is judged on what it reached rather than abandoned; `DIRTY_ENVIRONMENT` is the one a run reports when its data directory was not empty, which is a harness fault rather than a submission defect (`runbooks/grader-environment.md`).

### 8.2 Summary line

Every `TestResult` in a stage ends with the same stage summary line, and it is the last line of the output telemetry keeps; `score` is the stage total:

```
SUMMARY stage=production scenario=quiet-orbit units_per_10k=14820000 p95_ms=212 turnaround=0.97 lost=0 stuck=0 score=48.5/50
```

A measurement the run does not have is `-1`: `units_per_10k`, `p95_ms`, and `turnaround` each carry it where the scenario declares no such band or the run measured none, and `turnaround` carries it as `-1.00`, which is the form the five scenarios that declare no turnaround band emit.

## 10. Local parity

`npm run release -- --scenario quiet-orbit` runs `apps/release` on the laptop with the public seed, in either topology (`system-spec.md §10.2`), and produces the same deploy log. `raygun run --docker` reproduces the grader exactly. Local runs report through `raygun-report` to decant as opt-out telemetry, which is also the research stream.
