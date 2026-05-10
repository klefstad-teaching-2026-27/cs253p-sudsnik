# Sudsnik

An orbital laundry logistics platform. Twelve habitats send pods of laundry to three wash nodes by shuttle, and
the shuttles are only in contact with a habitat for ten minutes of every ninety-minute orbit. Nine services, seven
external providers, and a simulator that runs the physical world at six hundred times wall time.

You are taking over this system. It works. Each week you replace one component of it with your own, and a release
train runs the whole thing against a scenario and tells you what your component did to it.

## Getting this repository

Clone it, then push it to a repository of your own. Do not use GitHub's "Use this template" or "Fork" button:
a template gives you a single commit and throws the history away, and a fork of a public repository is itself
public, which puts your work in front of the class. The history is course material: [`docs/primer/09`](docs/primer/09-git-and-the-terminal.md) reads it,
and four of its exercises are questions only the history can answer.

```sh
git clone https://github.com/klefstad-teaching-2026-27/cs253p-sudsnik.git
cd cs253p-sudsnik
git remote rename origin upstream          # keep it: fixes to the starter arrive here
gh repo create <you>/cs253p-sudsnik --private --source . --remote origin --push
```

Without the `gh` command line, make an empty private repository on github.com and point this one at it instead
of the last line:

```sh
git remote add origin https://github.com/<you>/cs253p-sudsnik.git
git push -u origin main
```

`git log --oneline | wc -l` should say 41. If it says 1, you used the template button; delete it and clone.

## Quickstart

```sh
make hooks
npm ci
npm start
```

`npm start` prints every URL it bound; the stack is ready when `/ready` answers 200. [`docs/setup.md`](docs/setup.md) covers the
rest, including what each command does, what a first run looks like, and what to do when one of them doesn't
work; read it before anything else here.

## Where to start reading

1. [`docs/setup.md`](docs/setup.md): get the workspace running, once, before any of this.
2. [`docs/primer/`](docs/primer): ten short pages, in order, before Week 1. Each ends with an exercise against this system.
3. [`docs/system-spec.md`](docs/system-spec.md) §2: the world: habitats, pods, shuttles, nodes, orbits, link windows, and the numbers
   every scenario derives from.
4. [`docs/system-spec.md`](docs/system-spec.md) §5.1: the shape every service has: the routes it serves, where its configuration comes
   from, how it drains.
5. [`packages/contracts/src/services/`](packages/contracts/src/services): the contract of the component you are replacing. It is the
   agreement; your implementation is not.
6. [`AGENTS.md`](AGENTS.md): orientation for you and for any assistant you use: where things are, how a service is shaped,
   and the house rules a model will break without being told.

Then run a scenario and read `results/deploy-log.txt`; every finding code in it is explained in
[`docs/runbooks/deploy-log.md`](docs/runbooks/deploy-log.md).

## Turning in an assignment

Each week's brief names the **seam**: the package or packages you are allowed to change. Build the release
candidate from them and upload it.

```sh
make deploy SEAMS="orders"
```

`make deploy` re-runs the checks, refuses a dirty tree, and writes `dist/rc-<commit>.zip`. That file is the
submission. Upload it to the week's Gradescope assignment, named **Deploy: Week N**.

Where a week also submits something outside a service package, `EXTRA` names it:

```sh
make deploy SEAMS="notify dispatch" EXTRA="docs/runbooks"
```

Four things worth knowing before the first one:

- **Upload the zip, not your repository.** Only the seam is graded, and every file outside it costs the whole
  submission.
- **Every run is free.** There is no penalty for submitting again, and the deploy log says what to fix.
- **The submission you leave active is the one graded.** Submit as often as you like, then make sure the one
  showing as active is the one you meant.
- **A dirty tree writes no zip.** Commit what you are shipping first.

[`docs/autograder-spec.md`](docs/autograder-spec.md) has the stages and how a run is scored;
[`docs/runbooks/deploy-log.md`](docs/runbooks/deploy-log.md) explains every finding code the log can print.

Anything else a week asks for, the brief says where it goes.

## Layout

```
packages/      kernel, contracts, infra/*, clients, external (the mocks), services/* (`docs/system-spec.md` §4)
apps/          sim (the physical world), cli (start the stack), release (the release train)
tools/         lint (the house ESLint rules), fixtures (the calibrated band thresholds)
docs/          the setup guide, the system, the release train, the ADRs, the runbooks, the wiki
AGENTS.md      orientation for a coding agent working in this repository
TODO.md        what somebody meant to do
```

## Documents

| File | Owns |
|---|---|
| [`README.md`](README.md) | This: what the system is, how to get it, a quickstart, and where to start. |
| [`docs/setup.md`](docs/setup.md) | Getting the workspace running: prerequisites, the commands, first-run expectations, and troubleshooting. |
| [`docs/system-spec.md`](docs/system-spec.md) | The system: canon numbers, stack, layout, service convention, contracts, scenarios, build order. |
| [`docs/autograder-spec.md`](docs/autograder-spec.md) | The release train: its stages, what it measures, how a run is scored. |
| [`docs/adr/`](docs/adr) | The decisions this system was built on, including one that was superseded. |
| [`docs/wiki/`](docs/wiki) | What the team wrote down as it went: issues, transcripts, and one open pull request. |
| [`docs/runbooks/`](docs/runbooks) | One operational procedure each. |
| [`AGENTS.md`](AGENTS.md) | Where things are, how a service is shaped, the checks. |
