---
last_verified: 2026-04-26
status: active
---

# Accounts Reconcile Command Spec

`accounts reconcile` is the non-interactive balance reconciliation surface.
It compares ledger-native expected balances against a reference source and
prints analysis-friendly rows.

## Command

```sh
exitbook accounts reconcile [selector]
exitbook accounts reconcile [selector] --reference stored
exitbook accounts reconcile [selector] --reference live
exitbook accounts reconcile [selector] --refresh-live
exitbook accounts reconcile [selector] --all
exitbook accounts reconcile [selector] --strict
exitbook accounts reconcile [selector] --json
```

## Model

- Expected side: persisted accounting ledger postings aggregated by owner
  account, asset, and balance category.
- Reference side:
  - `stored`: latest stored live balance snapshot rows.
  - `live`: refresh live balances first, then compare against the refreshed
    live rows.
- Stored calculated balances are not used as the expected side.
- Existing legacy calculated-vs-live verification remains under
  `accounts refresh`.

## Statuses

Row statuses:

- `matched`: expected and reference quantities are within tolerance.
- `quantity_mismatch`: both sides exist but quantities differ.
- `missing_reference`: ledger expects a liquid balance but the selected
  reference source has no row.
- `unexpected_reference`: reference has a liquid balance outside the ledger
  expected set.
- `category_unsupported`: ledger expects a category the selected reference
  source cannot represent yet, such as staked or unbonding.

Scope statuses:

- `matched`: all comparable rows matched.
- `issues`: at least one mismatch, missing reference, or unexpected reference.
- `partial`: comparable rows matched, but at least one category was
  unsupported.
- `unavailable`: the scope could not be reconciled, usually because ledger
  postings or a usable reference snapshot are absent.
- `error`: command-side failure for that scope.

## Output

Text output should be concise by default:

- one header with reference source and tolerance
- one line per scope
- issue and unsupported rows only
- row counts and posting/source-activity counts when useful

`--all` includes matched rows in text output.

JSON output should include every row, every row status, quantities, reference
source, and provenance refs so downstream analysis can group or diff without
parsing terminal text.

## Exit Codes

- Default mode exits `0` if the command completed, even when it found
  reconciliation issues.
- `--strict` exits non-zero when any selected scope is not `matched`.
- Fatal setup errors still use normal CLI failure exit codes.
