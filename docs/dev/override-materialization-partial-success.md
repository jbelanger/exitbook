---
last_verified: 2026-04-19
status: active
---

# Override Materialization Partial-Success Issue

Owner: Codex + Joel
Primary references:

- [override-event-store-and-replay.md](/Users/joel/Dev/exitbook/docs/specs/override-event-store-and-replay.md)

## Problem

Some override write paths persist durable intent in `overrides.db` before the
same-process projection refresh succeeds.

Current affected paths:

- transaction movement-role writes
- transaction note writes
- any similar override flow that appends durably and then refreshes a derived
  projection as a follow-up step

Failure mode:

- durable override truth exists
- the current processed projection can remain stale
- command UX can imply rollback or total failure even though part of the write
  already succeeded

## Investigation Findings

### Confirmed affected paths

- `transactions edit note`
  - handler appends a durable `transaction-user-note` override event first
  - then materializes `transactions.user_notes_json`
- `transactions edit movement-role`
  - handler appends a durable `transaction-movement-role` override event first
  - then materializes `transaction_movements.movement_role_override`
  - then marks downstream projections stale for the owning account

### Confirmed post-append failure points

- note writes have one post-append failure point:
  - transaction user-note materialization
- movement-role writes have two post-append failure points:
  - transaction movement-role materialization
  - downstream stale-marking for `asset-review`, `balances`, and `links`

### Current retry behavior

- note writes do **not** self-heal on retry
  - after append succeeds, rerunning the same `set` command short-circuits from
    override replay and returns `changed=false`
  - after append succeeds, rerunning the same `clear` command also short-circuits
    and returns `changed=false`
  - result: the exact same command can report "unchanged" while the materialized
    transaction row is still stale
- movement-role materialization failures can usually be retried by rerunning the
  same command
  - retry still sees stale stored row state, so it appends again and attempts
    materialization again
- movement-role stale-marking failures do **not** self-heal on retry
  - by the time stale-marking fails, the processed transaction row is already
    updated
  - rerunning the same command then short-circuits as unchanged and skips
    downstream invalidation

### Current operator recovery path

- broad repair path exists: `exitbook reprocess`
  - reprocess resets processed projections
  - rebuilds processed transactions from raw data
  - re-materializes stored transaction overrides during the rebuild workflow
- no narrow transaction-override repair command currently exists
- affected transaction edit commands do not currently tell the user to run
  `reprocess` when post-append work fails

### Current spec and test gaps

- the transaction edit CLI spec currently describes append-then-materialize
  sequencing but does not model partial success in the public output contract
- note handler tests already prove "append succeeded, materialization failed"
  returns a plain error
- movement-role handler tests currently cover happy path and validation, but do
  not cover:
  - append succeeded, materialization failed
  - append succeeded, materialization succeeded, downstream stale-marking failed

## Investigation References

- [transactions-edit-note-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/command/transactions-edit-note-handler.ts)
- [transactions-edit-movement-role-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/command/transactions-edit-movement-role-handler.ts)
- [transactions-edit-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/transactions/transactions-edit-spec.md)
- [processing-ports.ts](/Users/joel/Dev/exitbook/packages/data/src/ingestion/processing-ports.ts)
- [run-reprocess.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/reprocess/command/run-reprocess.ts)

## Why This Matters

- accounting commands must report state changes honestly
- operators need a reliable recovery path when projection refresh fails
- read surfaces such as `transactions` and `issues` should not hide durable
  changes behind stale projections

## Required Outcome

- command results distinguish:
  - nothing persisted
  - override persisted and projection refresh succeeded
  - override persisted but projection refresh failed
- partial-success paths log clearly and give the operator an exact follow-up
  action
- projection refresh remains repairable without data loss

## Non-Goals

- redesigning the `issues` workflow
- adding a generic mutation surface
- replacing the override store unless the current model cannot support honest
  partial-success semantics

## Candidate Approaches

1. Keep append-first writes, but return explicit partial-success results and
   route the user to an exact repair or rebuild command.
2. Add a durable stale-projection marker or repair queue so read paths can
   surface drift honestly.
3. Revisit whether any affected write path can make append plus projection
   refresh atomic enough to remove the split-brain window.

## Recommended First Slice

- treat this first as a result-contract and repair-path problem, not an
  atomicity redesign
- add explicit partial-success result variants for:
  - note append persisted but materialization failed
  - movement-role append persisted but materialization failed
  - movement-role append and materialization succeeded but stale-marking failed
- in text and JSON output, surface `exitbook reprocess` as the current repair
  path until a narrower repair command exists
- add tests for the two missing movement-role post-append failure cases

## Exit Criteria

- partial success is modeled explicitly in command result types and human/JSON
  output
- at least one repair path is documented and tested
- canonical specs describe the behavior without implying rollback
