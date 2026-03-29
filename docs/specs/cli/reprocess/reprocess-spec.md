---
last_verified: 2026-03-29
status: draft
---

# Reprocess CLI Specification

## Overview

`exitbook reprocess` rebuilds derived state from saved raw imports.

This is a repair and regeneration workflow, not a sync workflow. It exists for cases where raw imports are already present but derived projections need to be rebuilt because processing logic changed, projections were cleared, or a previous processing run needs recovery.

`reprocess` must never fetch new exchange or blockchain data. If raw data itself is stale or missing, the user should run `exitbook import` first.

## Command Surface

### `exitbook reprocess`

Purpose:

- clear affected derived projections for the selected scope
- re-run transaction processing from stored raw imports
- report workflow progress and final counts

Options:

- `--account-id <id>`: rebuild one account scope only
- `--json`: emit structured results instead of human progress output
- `--verbose`: increase diagnostic detail without changing the presenter

## User Mental Model

Users should understand `reprocess` as:

- "rebuild what Exitbook already knows"
- not "import again"
- not "clear everything"

The command is appropriate after:

- importer or processor logic changes
- projection invalidation
- a failed or interrupted derived-data rebuild

It is not the primary entry point for newly fetched activity.

## Scope Rules

### Full Rebuild

With no `--account-id`, the command prepares a reprocess plan for all eligible accounts with stored raw imports in the active profile.

### Scoped Rebuild

With `--account-id`, the command rebuilds only the selected account scope.

The scope selection must happen before any destructive reset.

## Workflow Phases

### 1. Plan

Resolve the account scope and determine whether any work exists.

If the plan is empty, the command exits successfully with zero processed items.

### 2. Reset Derived Projections

Reset processed-transaction projections for the selected scope before re-running processing.

This is a derived-data reset only. Raw imports are preserved.

### 3. Reprocess Imported Sessions

Run the processing workflow over the stored imported sessions for the selected scope.

### 4. Report Outcome

Return:

- processed count
- failed count when applicable
- up to five processing error strings
- instrumentation summary in JSON mode

## Presentation

### Default Human Mode

`reprocess` is a workflow command. Its default human experience is a progress monitor, not a browse TUI.

The presenter should answer:

- whether planning succeeded
- whether projections were reset
- whether processing is advancing
- whether the run completed cleanly or failed

### JSON Mode

`--json` returns a structured payload containing:

- `status`: `success` or `warning`
- `reprocess.counts.processed`
- `reprocess.counts.failed` when non-zero
- `reprocess.processingErrors` limited to the first five messages
- `reprocess.runStats`
- `meta.timestamp`

JSON mode never mounts the workflow monitor.

## Completion Semantics

### Success

The command exits successfully when planning, reset, and processing all complete.

### Warning

If processing completes but still records recoverable processing errors, JSON reports `warning` and human output may show the first five errors after the main workflow summary.

### Failure

The command exits non-zero when:

- plan preparation fails
- projection reset fails
- processing fails
- any account in the selected run fails during processing

Failures must stop the workflow and surface the error directly.

## Error Handling

- errors are never silently downgraded into success
- if the workflow monitor is active, it must transition to a failed state before stopping
- aborts must stop the shared ingestion monitor cleanly

## Non-Goals

- no provider fetches
- no balance verification
- no partial destructive reset outside the selected scope
- no requirement to rerun imports when raw data is already present
