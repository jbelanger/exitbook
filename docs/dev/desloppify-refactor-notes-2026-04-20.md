# Desloppify Refactor Notes (2026-04-20)

## Reprocess Monitor Lifecycle

Immediate fix scope:

- Collapse the repeated `fail -> stop -> return err` monitor cleanup path in the reprocess runner
  into small local helpers.
- Build the reprocess execution runtime once per ingestion-runtime callback path instead of
  repeating the same object literal in the abort hook and main execution branch.

Useful follow-on refactors:

- Consider moving reprocess monitor lifecycle handling behind a small runtime-owned helper shared
  with other monitor-driven CLI workflows if more command slices repeat the same stop/fail/abort
  protocol.

## Accounts Refresh Text Presenter

Immediate fix scope:

- Move batch refresh text-progress rendering and single-refresh text output into a dedicated
  presenter module so the command support file stays focused on scope selection and JSON/text
  completion choice.
- Keep the existing command family shape intact while isolating spinner wiring, footer rendering,
  and import-guidance messaging in one text-only module.

Useful follow-on refactors:

- Split the batch text presenter into a pure event reducer plus a thin console adapter if refresh
  output rules continue to grow. The new presenter isolates the side effects, but it still mixes
  progress aggregation and console rendering in one file.

## Batch Import Executor Boundary

Immediate fix scope:

- Split the batch import path into a reusable executor that only runs account imports, emits
  per-account batch events, and returns account-level outcomes plus totals.
- Keep the CLI-facing `runBatchImport()` function focused on account discovery, presentation
  lifecycle, and abort wiring around that executor.

Useful follow-on refactors:

- Introduce a small batch-import runtime object that owns both execution and presentation cleanup
  if more batch import states need coordination. The current refactor separates execution from UI,
  but `runBatchImport()` still coordinates abort behavior and monitor stop semantics manually.

## Canada Artifact Codec Sections

Immediate fix scope:

- Replace the largest inline hand-mirrored encode/decode object literals in the Canada artifact
  codec with section-local helpers for calculation, execution meta, tax report summaries, display
  report items, and decimal-record conversion.
- Keep the stored schema unchanged while reducing the number of edit sites needed when one report
  field changes.

Useful follow-on refactors:

- Move each major stored section closer to its schema definition if this codec keeps growing. The
  current helper extraction reduces duplication, but the file still centralizes every schema and
  mapper in one large module.
