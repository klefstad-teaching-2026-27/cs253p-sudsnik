# `make canary` runs the release train here the way the grader runs it there, `make quick` runs it at a
# compressed clock for iteration, and `make deploy` builds the release candidate you upload. They report through
# the course helper when the starter carries one, and run directly when it does not.
UNAME_S := $(shell uname -s 2>/dev/null)
UNAME_M := $(shell uname -m 2>/dev/null)
HOST_OS := $(if $(filter Darwin,$(UNAME_S)),darwin,$(if $(filter Linux,$(UNAME_S)),linux,unknown))
HOST_ARCH := $(if $(filter arm64 aarch64,$(UNAME_M)),arm64,$(if $(filter x86_64 amd64,$(UNAME_M)),amd64,unknown))
HELPER := $(wildcard .coursetools/bin/coursetools-$(HOST_OS)-$(HOST_ARCH))
REPORT_BUILD := $(if $(HELPER),$(HELPER) build --,)
REPORT_TEST  := $(if $(HELPER),$(HELPER) test --,)
REPORT_RUN   := $(if $(HELPER),$(HELPER) run --,)

SCENARIO ?= quiet-orbit
SCALE ?= 1
comma := ,
space := $(subst ,, )
RC := $(shell git rev-parse --short HEAD 2>/dev/null || echo untracked)

# Where a run's results land. `canary` writes to `results/`, which is where the README and
# `docs/runbooks/deploy-log.md` send you to read a deploy log; `quick` writes under it rather than over it, so
# iterating never costs you the canary log you were about to read. RESULTS puts either run's results elsewhere.
RESULTS ?= results

# The rate `quick` compresses the simulated clock to, four times the rate the system is specified at. Every
# invariant keeps the verdict it reaches at the specified rate, but the bands drift with the rate, so a quick run
# says whether the component works and never how well.
QUICK_CLOCK_RATE ?= 2400
QUICK_NOTE := "make quick runs at SUDSNIK_CLOCK_RATE=$(QUICK_CLOCK_RATE), four times the rate this system is specified at: pass/fail iteration only. Its bands are distorted, which its deploy log records as clock=$(QUICK_CLOCK_RATE), and it writes that log to $(RESULTS)/quick/deploy-log.txt rather than over your canary's. Read your numbers from make canary, and submit what make deploy builds."

.PHONY: hooks build test canary quick deploy clean _seams

hooks:
	git config core.hooksPath .githooks

build:
	$(REPORT_BUILD) npm run typecheck
	$(REPORT_BUILD) npm run lint

test:
	$(REPORT_TEST) npm test

# The canary the grader runs first: the public seed, the known faults, one process. Read results/deploy-log.txt.
# SCENARIO and SCALE are the week's; Week 4 is `make canary SCENARIO=dark-side SCALE=2`. SEAMS names the packages
# the week asks for, so the units band is theirs rather than the system's.
canary:
	$(REPORT_RUN) npm run release -- --scenario $(SCENARIO) --scale $(SCALE) --single --results $(RESULTS) $(if $(SEAMS),--seam $(subst $(space),$(comma),$(strip $(SEAMS))),)

# The same run as `canary` with the clock compressed, for iterating in a minute rather than in three. SCENARIO,
# SCALE, and SEAMS are `canary`'s; the banner is what the compressed clock costs, and the deploy log's `clock=`
# says it again for a reader who did not see the banner. Its results go one directory down from the canary's,
# so a run you take for pass or fail never overwrites the run you take your numbers from.
quick:
	@echo $(QUICK_NOTE)
	@SUDSNIK_CLOCK_RATE=$(QUICK_CLOCK_RATE) $(REPORT_RUN) npm run release -- --scenario $(SCENARIO) --scale $(SCALE) --single --results $(RESULTS)/quick $(if $(SEAMS),--seam $(subst $(space),$(comma),$(strip $(SEAMS))),); status=$$?; echo $(QUICK_NOTE); exit $$status

# The release candidate: the checks, a clean tree, and a zip of the seams alone, named for the commit it holds.
# SEAMS names the packages the week asks for, space-separated: `make deploy SEAMS="billing"`. EXTRA names any other
# path the week submits, such as `docs/runbooks` in Week 6 or the v2 directories in Week 8.
_seams:
	@test -n "$(SEAMS)" || { echo "make deploy SEAMS=\"<service> ...\" names the packages this week's assignment asks for"; exit 2; }
	@test -z "$$(git status --porcelain)" || { echo "the tree is dirty; commit what you are shipping first"; git status --short; exit 2; }

deploy: _seams build test
	@mkdir -p dist && rm -f dist/rc-$(RC).zip
	@zip -qr dist/rc-$(RC).zip $(foreach s,$(SEAMS),packages/services/$(s)) $(EXTRA) -x '*/node_modules/*'
	@echo "release candidate dist/rc-$(RC).zip: upload it to the week's Gradescope assignment, Deploy: Week N"

clean:
	rm -rf data results dist
