# The starter's development container: Node 20, which is what the grader runs, and the command-line tools the
# labs type. `docs/setup.md` says when to use it.
FROM node:20-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gh jq less lsof make sqlite3 zip \
 && rm -rf /var/lib/apt/lists/*

USER node
