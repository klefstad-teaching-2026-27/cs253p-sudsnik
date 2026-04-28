# ADR-0005: Two firmware generations, both behind adapters

- Status: accepted
- Date: 2026-03-19

## Context

Node A runs firmware v1: holds by token, completion by polling status, and a hold that lapses silently. Nodes B
and C run v2: explicit holds, completion by callback, and a cycle you can read back. The v1 nodes are not being
upgraded this year, and the migration to v2 stopped after `start` and `release` moved over.

## Decision

`washnodes` talks to both through one `FirmwareAdapter` interface with a `v1` and a `v2` implementation. The
service above the adapters does not know which generation it is driving. The legacy RPC shim stays for the
calls v1 never migrated off.

## Consequences

Two code paths to test and two failure shapes to handle: v1 completions arrive by polling and can be missed, v2
completions arrive by callback and can be duplicated or held while a node is dark.

The half-finished migration is visible in the code and stays visible. Finishing it is not scheduled.
