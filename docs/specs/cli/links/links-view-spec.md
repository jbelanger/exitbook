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

`links gaps view <tx-ref>`, `links gaps explore <tx-ref>`, `links gaps resolve <tx-ref>`, and `links gaps reopen <tx-ref>` target a transaction ref inside the gaps workflow.

- The selector is the prefix of the persisted transaction fingerprint.
- The displayed `TX-REF` column uses that shortened prefix.
- One transaction may still produce multiple gap rows in the static list.
- When that happens, selector resolution stays transaction-level:
  - the command resolves by transaction fingerprint, not by asset row
  - static detail and JSON detail expose the count of gap rows on that transaction
  - `resolve` / `reopen` always apply to the whole transaction

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
- Each row corresponds to one unresolved movement coverage issue.
- Gap rows are ordered chronologically.
- Resolved transactions are hidden by default.
- Header and JSON metadata report how many resolved transactions are hidden.

List columns:

- `TX-REF`
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
exitbook links gaps view <gap_ref>
exitbook links gaps view <gap_ref> --json
```

Behavior:

- Renders one gap detail card with `TX-REF`, fingerprint, platform, date, operation, gap amount, coverage, and readiness.
- When the transaction has multiple gap rows, detail also shows the transaction-level gap-row count and makes it explicit that resolve/reopen are transaction-wide.
- Includes next-step guidance:
  - review suggested proposals with `links explore --status suggested` when suggestions exist
  - use `links gaps resolve <gap_ref>` when the transaction intentionally has no internal link
  - rerun `links run` when no suggestions exist yet

### Interactive Explorer

Commands:

```text
exitbook links gaps explore
exitbook links gaps explore <gap_ref>
```

Behavior:

- Opens the read-only gaps TUI.
- Selector preselects the gap row.
- Off-TTY or `--json` falls back to durable static/detail output.

### Gap Resolution Commands

Commands:

```text
exitbook links gaps resolve <gap_ref>
exitbook links gaps resolve <gap_ref> --reason "BullBitcoin purchase sent directly to wallet"
exitbook links gaps reopen <gap_ref>
exitbook links gaps reopen <gap_ref> --json
```

Behavior:

- `resolve` records a transaction-level reviewed exception without creating a link.
- `reopen` removes that transaction-level exception and returns the transaction to the open gaps lens.
- These commands use the same `TX-REF` shown in the gap list and gap detail.
- `--reason` stores free-form audit context on the override event.

## JSON Contract

### Lists

- Proposal lists return proposal summary rows.
- Gap lists return gap summary rows.
- JSON list output includes standard view metadata with active filters, including:
  - `hiddenResolvedIssues`
  - `hiddenResolvedTransactions`

### Detail

- Proposal detail returns one proposal object with leg-level detail.
- Gap detail returns one gap object plus transaction-level gap count metadata.
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
