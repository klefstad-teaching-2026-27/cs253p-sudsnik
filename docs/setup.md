# Setup

Getting the workspace running, and the commands you'll use every week. It assumes you can program and have used
git; it assumes nothing about Node, npm, or a monorepo.

## Prerequisites

- **Node 20.** Check what you have: `node --version`. If it doesn't print `v20.x`, install Node 20 with whatever
  you already use to manage versions. nvm, volta, fnm, your OS's package manager and the installer at
  nodejs.org all work here; none of them is required.
- **git.** Check with `git --version`; any recent release works.

Once those are in place, the four clone commands are in [`../README.md`](../README.md).

## The pieces

- `package.json`: the project's manifest: its dependencies, its npm scripts (`start`, `test`, and the rest below),
  and the `workspaces` list.
- `node_modules/`: every dependency, installed by `npm ci`. Gitignored, safe to delete, rebuilt by running
  `npm ci` again.
- Workspaces: this is a monorepo: `packages/` and `apps/` each hold several independent npm packages that share
  one `node_modules` and one lockfile at the repository root. You install once, from the root, never inside a
  package.
- `Makefile`: the commands you actually type day to day (`make hooks`, `make canary`, `make quick`, `make deploy`,
  `make clean`); each wraps the npm scripts below it in a few lines you can read straight through.

## The commands

- `make hooks`: points git at `.githooks` so the commit-message format is checked locally. Run it once per clone;
  nothing prints on success.
- `npm ci`: installs every dependency at the exact version `package-lock.json` pins, deleting `node_modules`
  first. Use this rather than `npm install`: `install` will happily resolve newer versions and rewrite the
  lockfile, and `ci` never touches it, so you get what the course pinned rather than whatever today's resolver
  would choose. Takes well under a minute and ends quietly.
- `npm start`: boots the full stack, its mocks, and an idle simulator; add `--single` to run them as one process
  instead of several. It prints every URL it bound; the stack is ready when `/ready` answers 200. Leave it running
  in one terminal and `curl` against it; `Ctrl-C` stops it.
- `npm test`: runs every package's tests once, with vitest. Green on a fresh clone; a failure here is yours.
- `make canary`: runs a full release train against the public scenario and writes `results/deploy-log.txt`. On
  an untouched clone it exits non-zero; see "First run" below.
- `make quick`: the same run at a compressed clock, for a pass/fail answer in about a minute instead of three.
  Its numbers are not the ones you report, only whether things still work. It writes to `results/quick/`, so it
  never overwrites the canary log you were about to read.
- `make deploy SEAMS="<service> ..."`: re-runs the checks (typecheck, lint, test), refuses if the tree is dirty,
  and zips the named package(s) into `dist/rc-<commit>.zip`: the file you upload. [`../README.md`](../README.md)
  has what to do with it.
- `make clean`: removes `data/`, `results/`, and `dist/`: the run's working data, its logs, and any release zip.
  `node_modules` and your source are untouched.

## First run

`make canary` on an untouched clone exits non-zero and reports failed invariants: orders stuck at the end of the
run, cancellations never honoured, no cost credit while a scenario invariant is failing. Nothing is wrong with
your clone. The components you'll replace are deliberately weak, and the release train is telling you what they
do to the system; that report is the assignment, not an error.

Read `results/deploy-log.txt` rather than the exit code. [`runbooks/deploy-log.md`](runbooks/deploy-log.md) explains every finding
code, and the score at the bottom is computed the same way the grader computes it.

## When something goes wrong

**Ports already in use.** `npm start`, `make canary`, `make quick`, and `make deploy` each boot their own copy of
the stack on the same fixed ports, and there is no offset to move them. A stack left running from `npm start` in
another terminal, or an earlier run that didn't exit cleanly, holds those ports, and the next run either refuses
outright or boots far enough to time out waiting on `/ready`. This is the single most common way a first run goes
wrong, and it reads as though your own machine is slow rather than as a process you left behind.
[`runbooks/deploy-log.md`](runbooks/deploy-log.md)'s `READY_TIMEOUT` entry has the command that finds it and what to do next.

**Wrong Node version.** `npm ci` warns rather than refuses if `node --version` isn't 20.x, so a mismatch usually
shows up later instead: a native module (`better-sqlite3`) failing to load at `npm start`, or `typecheck`
disagreeing with what your editor says. Check `node --version` first.

**A dirty tree refusing `make deploy`.** It runs `git status --porcelain` before anything else and refuses if that
prints anything, naming the paths still open. Commit what you're shipping, or stash or discard what you're not,
and run it again.

**`make clean`.** Removes `data/`, `results/`, and `dist/`. Reach for it if a run left the data directory in a
state you don't trust, or you just want a clean slate. It does not remove `node_modules`; you don't need
`npm ci` again unless a dependency changed.
