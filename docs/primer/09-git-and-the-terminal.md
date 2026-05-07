# Git and the terminal

Page 9 of the primer. You need the repository, not the running stack.

## 1. A terminal is how you ask this system questions

Everything in this course is reached from a shell. Four tools do almost all of it and you have met three already:
`curl` for HTTP, `sqlite3` for a service's rows, `jq` for JSON, and `grep` for the source. `jq` in particular is
not optional here: the traces this system writes are a file of JSON lines and
`docs/system-spec.md` §3 says to read them with it.

The one habit worth forming now is to ask the machine rather than guess. "Which services consume this event"
has an answer you can get in one command ([`06-queues-and-events.md` §5](06-queues-and-events.md)), and guessing costs more than asking.

```sh
grep -rl '"order.placed"' packages/services --include='*.ts' | sort
```

```
packages/services/dispatch/src/handlers/order.placed.ts
packages/services/dispatch/test/support/builders.ts
packages/services/notify/src/handlers/order.placed.ts
packages/services/notify/src/templates/index.ts
packages/services/notify/test/contract/contract.test.ts
packages/services/notify/test/helpers.ts
packages/services/notify/test/public/delivery.test.ts
packages/services/notify/test/public/ingest.test.ts
packages/services/notify/test/public/routes.test.ts
packages/services/orders/src/core/OrdersService.ts
packages/services/orders/test/public/place.test.ts
```

Three services, one publisher and two consumers, in one command, with `-l` for names only and `-n` when you want
the lines. The fourth line is the one worth noticing: `notify` also has a message template named after the
topic, which is not something [`06-queues-and-events.md`](06-queues-and-events.md) would have told you.

## 2. What git is for here

Git records the history of the repository as a chain of commits, each a snapshot with an author, a date, a
message, and a parent. `git log` walks it.

```sh
git log --oneline -5
```

```
c4a7e10 chore(coursetools): add the helper make reports through
166af84 chore: the system as the team handed it over
2916d1d docs: the system and the release train, written down
11670ef docs(wiki): issues and the transcripts they came from
f8285b4 docs(runbooks): releasing a stuck hold, and the grader
```

The hashes on this page are illustrative. A hash is a function of the whole history behind it, and this page is
itself part of that history, so no hash printed here can stay true of the tree you are holding. The subjects, the
authors and the dates are the tree's and will match; compare on those, never on a hash.

Forty-one commits. Forty are the team's, and the newest one is the course's:

```sh
git log --format='%an' | sort | uniq -c | sort -rn
```

```
  10 Leslie Lamport
   9 Radia Perlman
   7 Margaret Hamilton
   7 Grace Hopper
   7 Barbara Liskov
   1 CS 253P Course Staff
```

The last line is worth reading as the history telling you something true: five people built this system, and a
sixth commit came from somewhere else. It added `.coursetools/`, which is how `make` reports your build and test
runs to the course. Nothing you are asked to do this term is in it. Telling inherited work from what was laid on
top of it is most of what reading an unfamiliar history is for.

This is not decoration. In a system you did not write, the history is one of the few places the reasons survive.
Documentation says what is true now. A commit says what changed and who thought it was a good idea.

## 3. Three questions worth knowing how to ask

Who last touched this, and when:

```sh
git log -1 --format='%an, %ad' --date=short -- packages/services/orders
```

```
Margaret Hamilton, 2026-03-26
```

Which commits changed a particular string, anywhere:

```sh
git log -S 'firmware_ref' --oneline
```

```
2916d1d docs: the system and the release train, written down
f8285b4 docs(runbooks): releasing a stuck hold, and the grader
205cc6b feat(washnodes): washer inventory, holds, and cycles
```

Three commits, and only one of them is code. `firmware_ref` is a column in `washnodes`, and the second place it
has ever appeared is an operational procedure for when a hold gets stuck. Nothing in `washnodes` links to that
runbook. `git log -S` found it because it searched the history rather than the checkout.

The third is this page, which mentions the column in the example above. That is not noise to skip over: `-S`
searches everything the history contains, documentation included, and a search that turns up the document
describing the thing is telling you something true about where a name lives.

Who wrote these particular lines:

```sh
git blame -L 84,86 --date=short packages/services/orders/src/core/OrdersService.ts
```

```
4552d5e7 (Margaret Hamilton 2026-03-26 84)       state: "placed",
4552d5e7 (Margaret Hamilton 2026-03-26 85)       payment: "pending",
4552d5e7 (Margaret Hamilton 2026-03-26 86)       placedAt: now,
```

`git show <hash>` then prints that whole commit, and `git show --stat <hash>` prints only which files it touched
and by how much, which is usually what you want first.

## 4. Two rules for your own commits

Commit messages here follow Conventional Commits: `<type>(<scope>): <summary>`, with the summary in the
imperative and under 72 characters. `make hooks` installs the hook that enforces it, and `README.md` under
Setup says to run it once per clone. Every commit above is an example.

Commit before you experiment, not after. Pages 8 and 10 both tell you to change a line and put it back, and
`git diff` being empty afterwards is how you know you did. That is the cheapest safety net you will ever get.

## 5. Exercise

Answer each of these with one command, and write down the command as well as the answer.

1. Which commit introduced `packages/infra/cache`? Give its subject and its author rather than its hash.
2. How many commits touched anything under `docs/`? It is a small number and it will surprise you.
3. The file `TODO.md` is at the root of the repository. Which commit added it, and what else did that same
   commit add? `git show --stat` will tell you, and the answer is a surprise worth having.
4. `packages/services/orders/src/core/OrdersService.ts` and
   `packages/services/notify/src/handlers/order.placed.ts` do not import each other and are in different
   packages. Find, from the history alone, whether the same person wrote both.
