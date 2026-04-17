# Links Browse Spec

## Overview

The `links` family now follows the standard browse contract:

- `exitbook links` / `exitbook links list` -> static list
- `exitbook links view <link-ref>` -> static detail
- `exitbook links explore [link-ref]` -> interactive explorer

`links` has two browse families:

- proposals under `links`
- gaps under `links gaps`

`links run`, `links create`, `links confirm`, and `links reject` remain separate workflow/review commands.

## Selector Model

### Proposal Selectors

`links view <link-ref>` and `links explore <link-ref>` target a transfer proposal.

- The selector is a short `LINK-REF` derived from the transfer proposal key.
- The displayed `LINK-REF` column uses the first 10 hex chars of the SHA-256 digest of that proposal key.
- Ambiguous ref prefixes must fail and tell the user to provide a longer ref.

### Gap Selectors

`links gaps view <gap-ref>`, `links gaps explore <gap-ref>`, `links gaps resolve <gap-ref>`, and `links gaps reopen <gap-ref>` target one gap issue inside the gaps workflow.

- The selector is a short `GAP-REF` derived from `txFingerprint + assetId + direction`.
- The displayed `GAP-REF` column uses the first 10 hex chars of the SHA-256 digest of that issue identity.
- One transaction may still produce multiple gap rows in the static list.
- When that happens, each row has its own selector and `resolve` / `reopen` apply only to that asset-direction issue.

## Proposal Lens

### Static List

Commands:

```text
exitbook links
exitbook links list
exitbook links --status suggested
exitbook links --min-confidence 0.8
exitbook links --json
```

Behavior:

- Shows proposal rows, not raw link legs.
- Groups all legs in the same transfer proposal into one row.
- Root and `list` are equivalent.

Filters:

- `--status suggested|confirmed|rejected`
- `--min-confidence`
- `--max-confidence`

List columns:

- `LINK-REF`
- `DATE`
- `ASSET`
- `STATUS`
- `ROUTE`
- `CONF`
- `LEGS`

### Static Detail

Commands:

```text
exitbook links view <proposal_ref>
exitbook links view <proposal_ref> --verbose
exitbook links view <proposal_ref> --json
```

Behavior:

- Renders one durable proposal detail card.
- Includes `LINK-REF`, status, route, confidence, matched amount, and leg list.
- `--verbose` adds full address details where available.
- Suggested proposals include `links confirm <proposal_ref>` and `links reject <proposal_ref>` next-step hints using the same `LINK-REF`.
- When no proposal exists but the exact pair is already known, the manual path is `links create <source_ref> <target_ref> --asset <symbol>`.

Invalid combinations:

- proposal selector + `--status`
- proposal selector + confidence filters

### Interactive Explorer

Commands:

```text
exitbook links explore
exitbook links explore --status suggested
exitbook links explore <proposal_ref>
```

Behavior:

- Opens the existing proposal-review TUI.
- Selector preselects the target proposal.
- Confirm/reject actions remain inline and proposal-scoped.
- Off-TTY or `--json` falls back to durable static/detail output.

## Gaps Lens

### Static List

Commands:

```text
exitbook links gaps
exitbook links gaps --json
```

Behavior:

- Shows coverage-gap issues, not proposals.
- Each row corresponds to one unresolved asset-direction coverage issue.
- Fully explained exact residuals are omitted from the open list because they are not user-actionable transfer-review work.
- Gap rows are ordered chronologically.
- Resolved gap issues are hidden by default.
- Header and empty-state messaging report how many resolved gap exceptions are hidden.
- Header summary distinguishes:
  - gaps that already have transfer suggestions
  - gaps that still have no suggestions
- JSON metadata reports how many resolved gap issues are hidden.
- Rows may include inline review context when the analyzer has:
  - a likely heuristic cue (`gapCue`)
  - or deterministic diagnostic / movement-role context (`contextHint`)
- Current cue labels include:
  - `likely low-value dust`
  - `likely correlated service swap`
  - `likely receive then forward`
  - `likely cross-chain migration`
  - `likely same-owner cross-chain bridge`

List columns:

- `GAP-REF`
- `DATE`
- `PLATFORM`
- `DIR`
- `ASSET`
- `MISSING`
- `COVERAGE`
- `READINESS`

### Static Detail

Commands:

```text
exitbook links gaps view <gap-ref>
exitbook links gaps view <gap-ref> --json
```

Behavior:

- Renders one gap detail card with `GAP-REF`, transaction ref, fingerprint, platform, date, operation, asset id, gap amount, coverage, and readiness.
- When present, detail also shows:
  - blockchain transaction hash
  - raw `from` / `to` endpoint values from the processed transaction
  - endpoint ownership context such as `owned source -> other-profile destination`
  - shared transaction investigation context reused from `transactions view`,
    including:
    - exact owned-account matches for visible endpoints
    - open gap refs affecting the transaction
    - same-hash sibling transaction refs
    - nearby transaction refs sharing the same `from` endpoint
    - nearby transaction refs sharing the same `to` endpoint
  - a cue line describing the likely pattern behind the issue
  - a counterpart transaction ref when the cue is paired to another specific
    transaction
  - a context line describing deterministic diagnostic or movement-role context on the transaction
  - exact `links confirm <LINK-REF>` commands when the gap can be mapped to one
    or more specific suggested proposals
- When the transaction has multiple gap rows, detail also shows the count of open gap rows still present on that transaction.
- When multiple open gap rows share the same blockchain transaction hash across
  different processed transactions, detail also shows:
  - the open same-hash gap-row count
  - the sibling transaction refs still open on that hash
- Includes next-step guidance:
  - confirm the first exact `LINK-REF` directly when specific proposal refs are
    known
  - inspect the paired transaction first when the gap carries a paired cue such
    as `likely same-owner cross-chain bridge`
  - inspect the paired transaction, then resolve the gap when the cue suggests
    adjacent non-link activity such as `likely correlated service swap` or
    `likely receive then forward`
  - review suggested proposals with `links explore --status suggested` only
    when suggestions exist but no exact ref can be derived
  - use `links gaps resolve <gap-ref>` when the transaction intentionally has no internal link
  - rerun `links run` when no suggestions exist yet

### Interactive Explorer

Commands:

```text
exitbook links gaps explore
exitbook links gaps explore <gap-ref>
```

Behavior:

- Opens the read-only gaps TUI.
- Selector preselects the gap row.
- Off-TTY or `--json` falls back to durable static/detail output.

### Gap Resolution Commands

Commands:

```text
exitbook links gaps resolve <gap-ref>
exitbook links gaps resolve <gap-ref> --reason "BullBitcoin purchase sent directly to wallet"
exitbook links gaps reopen <gap-ref>
exitbook links gaps reopen <gap-ref> --json
```

Behavior:

- `resolve` records a resolved gap exception without creating a link.
- `reopen` removes that gap exception and returns that gap row to the open gaps lens.
- These commands use the same `GAP-REF` shown in the gap list and gap detail.
- `--reason` stores free-form audit context on the override event.

## JSON Contract

### Lists

- Proposal lists return proposal summary rows.
- Gap lists return gap summary rows.
- JSON list output includes standard view metadata with active filters, including:
  - `hiddenResolvedIssues`
- Gap rows include `gapCue` and `contextHint` when the analyzer derives them.
- Gap rows may also include:
  - `gapCueCounterpartTxFingerprint`
  - `gapCueCounterpartTransactionRef`
- Gap rows may include `transactionSnapshot` with:
  - `blockchainTransactionHash`
  - `from`, `fromOwnership`
  - `to`, `toOwnership`
  - `openSameHashGapRowCount`
  - `openSameHashTransactionRefs`
- Gap rows may include `relatedContext` with:
  - `fromAccount`
  - `toAccount`
  - `openGapRefs`
  - `sameHashSiblingTransactionRefs`
  - `sameHashSiblingTransactionCount`
  - `sharedFromTransactionRefs`
  - `sharedFromTransactionCount`
  - `sharedToTransactionRefs`
  - `sharedToTransactionCount`

### Detail

- Proposal detail returns one proposal object with leg-level detail.
- Gap detail returns one gap object plus `transactionGapCount` metadata for the containing transaction.
- Gap detail and summary rows may include `suggestedProposalRefs` when the CLI
  can map visible suggested proposals back onto that gap identity.
- Gap detail uses the same `transactionSnapshot` shape as gap summary rows.
- Gap detail uses the same `relatedContext` shape as `transactions view`.
- Detail metadata includes the selected ref.

## Review Commands

`links create <source_ref> <target_ref> --asset <symbol>`, `links confirm <proposal_ref>`, and `links reject <proposal_ref>` stay as standalone mutations around the browse surface.

- `links create` is transaction-scoped and exact-movement-scoped rather than proposal-scoped.
- They target the same `LINK-REF` used by `links view <proposal_ref>` and `links explore <proposal_ref>`.
- They remain standalone review mutations rather than becoming selector-based browse commands.

## Semantic Rules

- `status` applies only to persisted proposals: `suggested`, `confirmed`, `rejected`
- `gaps` is a separate coverage-analysis workflow, not a status
- `needs-review` remains deferred until a unified queue shape is explicitly designed
