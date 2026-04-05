# Accounts CLI Spec

## Scope

This document defines the `accounts` command family:

- `exitbook accounts`
- `exitbook accounts <selector>`
- `exitbook accounts view`
- `exitbook accounts view <selector>`
- `exitbook accounts refresh`
- `exitbook accounts refresh <selector>`

It specializes the browse-ladder rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md). The browse ladder remains normative. This file defines what the `accounts` family renders and how its workflow command behaves.

Out of scope:

- `accounts add`
- `accounts update`
- `accounts remove`

## Family Model

The `accounts` family has two distinct responsibilities:

- browse commands inspect stored account and balance data
- refresh commands rebuild and verify balances, then persist refreshed snapshots

Rules:

- browse commands are read-only and never call live providers
- refresh commands are workflow commands and may call live providers
- provider credentials are owned by account configuration, not by refresh flags
- exchange accounts imported from CSV may still store provider credentials for balance verification

## Command Surface

### Browse shapes

| Shape                       | Meaning                                                           | Human surface      |
| --------------------------- | ----------------------------------------------------------------- | ------------------ |
| `accounts`                  | Quick browse of accounts in the active profile                    | Static list        |
| `accounts <selector>`       | Focused inspection of one account and its stored balance snapshot | Static detail card |
| `accounts view`             | Full accounts explorer                                            | TUI explorer       |
| `accounts view <selector>`  | Explorer pre-selected on one account                              | TUI explorer       |
| Any of the above + `--json` | Machine output for the same semantic target                       | JSON               |

On a non-interactive terminal:

- `accounts view` falls back to the same static list as `accounts`
- `accounts view <selector>` falls back to the same static detail as `accounts <selector>`

`view` does not define a separate text schema or JSON schema.

### Refresh shapes

| Shape                         | Meaning                                                           | Human surface |
| ----------------------------- | ----------------------------------------------------------------- | ------------- |
| `accounts refresh`            | Refresh all eligible account balance scopes in the active profile | Text-progress |
| `accounts refresh <selector>` | Refresh one requested account's owning balance scope              | Text-progress |
| Any of the above + `--json`   | Machine output for the same workflow target                       | JSON          |

Refresh never prints the full account detail card. Users inspect refreshed data through the browse surfaces after the workflow completes.

## Selectors And Options

### Bare selector

`<selector>` is a command-shape selector, not a generic filter flag.

Resolution order:

1. account name
2. unique fingerprint prefix

Behavior:

- bare selector misses fail with `Account selector '<value>' not found`
- bare selectors cannot be combined with `--platform` or `--type`
- bare selectors may target child accounts when the fingerprint prefix resolves to a child account

### Browse options

Supported browse options:

- `--platform <name>`: filter by platform key
- `--type <type>`: filter by account type (`blockchain`, `exchange-api`, `exchange-csv`)
- `--show-sessions`: include recent import session details in detail surfaces and JSON
- `--json`: output JSON

### Refresh options

Supported refresh options:

- `--json`: output JSON

Refresh intentionally does not accept:

- `--api-key`
- `--api-secret`
- `--api-passphrase`
- `--platform`
- `--type`

Credential lookup for refresh is resolved entirely from stored account configuration.

## Shared Data Semantics

### Hierarchy And Counts

Accounts are rendered as top-level rows by default.

Rules:

- top-level parents appear in list surfaces
- child accounts appear under `Derived addresses` in detail surfaces
- when the selected account is itself a child account, detail surfaces show that child directly
- a parent account's `Imports` value includes its own sessions plus child sessions
- `Derived addresses` rows show per-child import counts
- `total` counts every account in scope, including nested child accounts
- type counts summarize the displayed top-level rows

This means the `total` count can exceed the sum of the type counts when derived child accounts are present.

### Requested Account vs Balance Scope

Account detail is always anchored on the requested account.

Balance data may resolve to a different owning scope account when the selected account is a child account.

Rules:

- browse detail identifies the requested account first
- when balance resolution climbs to a parent scope, the balance section renders both `Requested` and `Balance scope`
- refresh operates on the owning balance scope, not necessarily the requested child account
- JSON includes both the requested account and the resolved balance scope when they differ

### Stored Balance Semantics

Browse detail uses stored balance data only.

Stored balance detail may include:

- calculated balances
- last verified live balances from the stored snapshot
- per-asset comparison status
- snapshot verification status
- projection freshness
- last calculated and last refresh timestamps
- stored status reason and suggestion text

Rules:

- stored live balances are never labeled as current live balances
- stored live balances are labeled `last verified live`
- `Last refresh` refers to the timestamp of the stored snapshot refresh, not the current wall clock

### Unreadable Stored Snapshots

Accounts browse detail is not fail-closed for balance display.

If a stored snapshot is missing, stale, building, or failed:

- the account detail still renders
- the balance section renders the concrete reason instead of an asset table
- the surface includes a concrete next step
- when no imported transaction data exists yet, the next step points users to `exitbook import` instead of `accounts refresh`

Example:

```text
Balances
No balance data yet. This account has no imported transaction data yet.
Next: run "exitbook import" to import transaction data first.
```

## Browse Surfaces

### Static List Surface

Applies to:

- `exitbook accounts`
- `exitbook accounts view` off-TTY

#### Header

Format:

```text
Accounts{optional filter label} {total} total · {type counts...}
```

Rules:

- `Accounts` is bold
- metadata is dim
- only non-zero type counts are shown
- filter label is `({platform})` or `({type})`
- no blank line before the header
- one blank line follows the header before the table or empty state

Examples:

```text
Accounts 6 total · 2 blockchain · 3 exchange-api · 1 exchange-csv
```

```text
Accounts (kraken) 2 total · 1 exchange-api · 1 exchange-csv
```

#### Table

Static list output is account-first. It is for discovery, but it may include a compact stored balance count.

Columns:

| Column       | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `REF`        | First 10 characters of the account fingerprint                           |
| `NAME`       | Account name when present; otherwise the full display label              |
| `PLATFORM`   | Platform key                                                             |
| `TYPE`       | Account type                                                             |
| `ASSETS`     | Stored asset count for the owning balance scope when readable            |
| `IDENTIFIER` | Truncated identifier when the account has a separate name; otherwise `—` |

Example:

```text
Accounts 1 total · 1 blockchain

REF         NAME         PLATFORM      TYPE           ASSETS   IDENTIFIER
61637d8a6e  inj-wallet   injective     blockchain          1   inj1zk...pty4rau
```

Rules:

- no controls footer
- no quit hint
- no selected-row expansion
- no side-by-side detail panel
- `ASSETS` renders the stored asset count for the resolved owning scope
- when the stored snapshot is unreadable, `ASSETS` renders `—`
- child accounts do not appear as separate rows unless the query resolves directly to a child account
- static list does not render per-asset balance rows

#### Empty states

Unfiltered empty state:

```text
Accounts 0 total

No accounts found.

Tip: exitbook accounts add my-wallet --blockchain ethereum --address 0x...
```

Filtered empty state:

```text
Accounts (kraken) 0 total

No accounts found for kraken.
```

### Static Detail Surface

Applies to:

- `exitbook accounts <selector>`
- `exitbook accounts view <selector>` off-TTY

#### Header line

The first line is a compact title, not a boxed card title.

Format:

```text
{title} {ref?} {platform} {type}
```

Where:

- `{title}` is the account name when present, otherwise the fingerprint ref
- `{ref}` is shown only when the account has a separate name
- `{platform}` is cyan
- `{type}` is dim

Example:

```text
injective-wallet 61637d8a6e injective blockchain
```

#### Body

Field order:

1. `Name`
2. `Fingerprint`
3. `Identifier`
4. `Provider`
5. `Created`
6. optional `Balance data` / `Live check`
7. optional `Last calculated`
8. optional `Last refresh`
9. optional `Imports`
10. optional `Requested`
11. optional `Balance scope`
12. `Balances`
13. optional `Derived addresses`
14. optional `Recent sessions`

Example:

```text
injective-wallet 61637d8a6e injective blockchain

Name: injective-wallet
Fingerprint: 61637d8a6e50994899173aac3ad017eba84d83933982864fc7198a8e42287251
Identifier: inj1zk3259rhsxcg5og96eursm4x8ek2qc5pty4rau
Provider: —
Created: 2026-04-02 13:50:15

Balance data: ✓ up to date · Live check: ✓ verified
Last calculated: 2026-04-03 11:47:26
Last refresh: 2026-04-03 11:47:26
Imports: 1

Balances (1)
ASSET   CALCULATED               LAST VERIFIED LIVE       STATUS   TXS
INJ     70.72654510000000000002  70.72654510000000000002  match    6
```

#### Balance section rules

Columns:

| Column               | Meaning                                                   |
| -------------------- | --------------------------------------------------------- |
| `ASSET`              | Asset symbol                                              |
| `CALCULATED`         | Stored calculated balance                                 |
| `LAST VERIFIED LIVE` | Stored live balance from the last successful verification |
| `STATUS`             | Stored comparison status                                  |
| `TXS`                | Transaction count from diagnostics                        |

Rules:

- when no stored live verification value exists, `LAST VERIFIED LIVE` renders `—`
- `STATUS` renders `match`, `warning`, `mismatch`, `unavailable`, or `—`
- `TXS` comes from stored transaction diagnostics
- if the snapshot is unreadable, the table is replaced by a reason block plus refresh hint
- no extra trailing blank line after the final rendered line

#### Optional sections

- `Derived addresses ({n})`
- `Recent sessions`

Rules:

- static detail does not artificially cap child rows, session rows, or asset rows
- `Provider` shows `—` when unset
- `Identifier` uses the full display identifier stored in the view model
- `Imports` uses the bare numeric count
- the `Balance data` / `Live check` row is hidden when both values are still untouched for a new account
- balance-data labels are `up to date`, `out of date`, `building`, `failed`, `not yet calculated`
- live-check labels are `verified`, `warning`, `mismatch`, `unavailable`, `not yet run`

### Explorer Surface

Applies to:

- `exitbook accounts view`
- `exitbook accounts view <selector>`

The explorer is a master-detail Ink app with two views:

- `accounts`: account list plus account detail
- `assets`: asset drilldown for the selected account

#### Accounts view layout

The accounts view renders:

1. a blank line
2. the shared header
3. a blank line
4. a selectable account list
5. a divider
6. a fixed-height detail panel
7. a blank line
8. a controls bar

The header matches the static surface and adds `· sessions visible` when `--show-sessions` is set.

#### Accounts view rows

Explorer rows are not the static table.

Each row contains:

- fingerprint ref
- platform
- type
- name or label
- optional identifier suffix when the account has a separate name
- import summary
- optional `+N derived` suffix for parent accounts
- projection status as `proj:<label>`
- verification status as `ver:<label>`

Example:

```text
▸ 61637d8a6e injective  blockchain  injective-wallet  1 import  proj:fresh  ver:ok
```

Status labels:

- projection: `fresh`, `stale`, `build`, `fail`, `—`, `?`
- verification: `ok`, `warn`, `fail`, `n/a`, `—`, `?`

#### Accounts detail panel

The accounts detail panel uses the same underlying fields as the static detail card, but:

- prefixes the title with `▸`
- is height-limited
- may truncate the balance preview and optional sections
- shows an overflow line when more detail exists than can fit

Overflow copy:

```text
... N more detail line(s). Rerun with --json for full details.
```

#### Asset drilldown

`Enter` drills from the selected account into the selected account's asset view when balance data is available.

Asset drilldown uses stored snapshot data only.

The asset view shows:

- calculated balances
- last verified live balances when present
- comparison status
- per-asset diagnostics

If no balance data is available:

- the explorer stays in the accounts view
- the account detail panel shows the concrete reason and refresh hint

#### Explorer navigation

| Key               | Action                               |
| ----------------- | ------------------------------------ |
| `↑` / `k`         | Move up                              |
| `↓` / `j`         | Move down                            |
| `PgUp` / `Ctrl-U` | Page up                              |
| `PgDn` / `Ctrl-D` | Page down                            |
| `Home`            | Jump to first row                    |
| `End`             | Jump to last row                     |
| `Enter`           | Drill into assets from accounts view |
| `Backspace`       | Return from asset view               |
| `q` / `Esc`       | Quit, or return when drilled down    |

Accounts view controls bar:

```text
↑↓/j/k · ^U/^D page · Home/End · Enter balances · q/esc quit
```

Asset view controls bar:

```text
↑↓/j/k · ^U/^D page · Home/End · Enter/backspace back · q/esc back
```

#### Selector behavior

`accounts view <selector>` opens the explorer pre-selected on the requested account.

#### Empty explorer behavior

Explorer empties follow the V3 rules:

- `accounts view` with a truly empty unfiltered collection collapses to the static empty state
- filtered-empty explorer requests stay on the explorer code path instead of silently downgrading to static output
- selector misses fail before any renderer mounts

## Refresh Workflow

### Purpose

`accounts refresh` rebuilds stored balance snapshots and verifies them against live providers when supported.

Rules:

- refresh persists the refreshed snapshot before returning
- refresh uses provider credentials stored on accounts
- refresh never accepts credential overrides through CLI flags
- when a provider does not support live verification for a scope, refresh persists a calculated-only snapshot and marks verification unavailable

### Single-account refresh

Applies to:

- `exitbook accounts refresh <selector>`

Behavior:

- resolve the requested account
- resolve the owning balance scope
- run refresh for that scope
- persist the refreshed snapshot
- print a compact workflow summary, not the account detail card

Example:

```text
Refreshing injective-wallet 61637d8a6e injective blockchain...
Resolving balance scope...
Rebuilding calculated balances...
Fetching live balances from injective...
Verified 1 asset · 1 match
Stored snapshot updated: 2026-04-03 11:47:26

Inspect with: exitbook accounts injective-wallet
```

Rules:

- if the requested account resolves upward to a parent scope, the summary renders both `Requested` and `Balance scope`
- single-account refresh may surface warnings, partial coverage, and suggestion text
- single-account refresh uses the same text-progress model as all-accounts refresh
- single-account refresh does not open the browse explorer

### All-accounts refresh

Applies to:

- `exitbook accounts refresh`

Behavior:

- load top-level accounts eligible for verification
- resolve per-account stored credentials
- skip accounts that cannot be refreshed
- refresh remaining scopes sequentially
- persist each refreshed snapshot as it completes

On an interactive terminal without `--json`, all-accounts refresh remains line-oriented. It does not mount a browse-style TUI.

Progress output may include:

- an initial eligibility summary
- one line when an account starts verification
- one line when an account is skipped
- one line when an account completes
- periodic provider or call-stat summaries for long-running work
- a final outcome summary

Rules:

- output must remain legible in scrollback, pipes, and CI
- no full-screen Ink chrome
- no cursor-control progress UI
- no spinner-only feedback
- spinners may appear only as a supplemental prefix to a normal progress line, never as the sole indication of work
- provider call stats, failure counts, fallback counts, and coverage summaries are allowed when they help explain latency or degraded verification quality

Example:

```text
Refreshing 6 account scopes...
kraken-main: skipped (stored provider credentials missing)
injective-wallet: verifying with injective...
injective-wallet: match · 1 asset
bitcoin-main: verifying with mempool-space...
bitcoin-main: warning · 2 assets · 1 partial parse failure
Provider stats: 14 calls · 1 fallback · 0 circuit-open

Refresh finished with issues: 6 total · 5 verified · 1 skipped · 1 error
Details: 4 matches · 1 mismatch
Next: run "exitbook import" for accounts without completed imported data, then rerun "exitbook accounts refresh".
```

Per-account result statuses:

- `success`
- `warning`
- `failed`
- `skipped`
- `error`

All-account refresh text rules:

- import-related failures may be shortened per account line when the footer already provides the shared next step
- the final `Details:` line is omitted when every aggregate count in that line is zero
- singular/plural outcome counts must read naturally, for example `1 error` and `2 errors`

## JSON

JSON output uses the standard CLI success envelope:

```json
{
  "success": true,
  "command": "accounts",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "data": {
    "...": "command payload"
  }
}
```

### Browse JSON

JSON follows the same semantic target regardless of whether the command uses `view`.

- `accounts --json` and `accounts view --json` return the same list payload shape
- `accounts <selector> --json` and `accounts view <selector> --json` return the same detail payload shape

#### List payload

List payload is summary-shaped.

Rules:

- list items include account summary fields, verification summary fields, and timestamps
- list items do not inline full asset arrays
- `sessions` is only populated when `--show-sessions` is passed

#### Detail payload

Detail payload extends the account summary with a nested `balance` object.

Example:

```json
{
  "data": {
    "id": 1,
    "accountFingerprint": "61637d8a6e50994899173aac3ad017eba84d83933982864fc7198a8e42287251",
    "accountType": "blockchain",
    "platformKey": "injective",
    "name": "injective-wallet",
    "identifier": "inj1zk3259rhsxcg5og96eursm4x8ek2qc5pty4rau",
    "balanceProjectionStatus": "fresh",
    "lastCalculatedAt": "2026-04-03T15:47:26.000Z",
    "lastRefreshAt": "2026-04-03T15:47:26.000Z",
    "verificationStatus": "match",
    "sessionCount": 1,
    "createdAt": "2026-04-02T17:50:15.000Z",
    "balance": {
      "scopeAccount": {
        "id": 1,
        "accountFingerprint": "61637d8a6e50994899173aac3ad017eba84d83933982864fc7198a8e42287251",
        "accountType": "blockchain",
        "platformKey": "injective",
        "identifier": "inj1zk3259rhsxcg5og96eursm4x8ek2qc5pty4rau"
      },
      "assets": [
        {
          "assetId": "blockchain:injective:native",
          "assetSymbol": "INJ",
          "calculatedBalance": "70.72654510000000000002",
          "liveBalance": "70.72654510000000000002",
          "comparisonStatus": "match",
          "diagnostics": {
            "txCount": 6
          }
        }
      ]
    }
  }
}
```

Rules:

- `liveBalance` in browse JSON means the last verified live balance captured in the stored snapshot
- when a child request resolves to a parent balance scope, detail JSON includes both `requestedAccount` and `balance.scopeAccount`
- undefined properties are omitted from serialized JSON

### Refresh JSON

Refresh JSON is workflow-shaped.

#### Single-account refresh JSON

Shape:

```json
{
  "data": {
    "account": {
      "id": 1,
      "platformKey": "injective",
      "accountType": "blockchain"
    },
    "requestedAccount": {
      "id": 1,
      "platformKey": "injective",
      "accountType": "blockchain"
    },
    "status": "match",
    "summary": {
      "totalAssets": 1,
      "matches": 1,
      "warnings": 0,
      "mismatches": 0
    },
    "coverage": {
      "status": "full"
    },
    "warnings": [],
    "partialFailures": [],
    "suggestion": "Balances match"
  }
}
```

#### All-accounts refresh JSON

Shape:

```json
{
  "data": {
    "accounts": []
  },
  "meta": {
    "totalAccounts": 6,
    "verified": 5,
    "skipped": 1,
    "matches": 4,
    "mismatches": 1,
    "timestamp": "2026-04-03T15:47:26.000Z"
  }
}
```

## Errors And Help

Expected browse-family errors:

- `Use bare "accounts" instead of "accounts list".`
- `Account selector '<value>' not found`
- `Account selector '<value>' is ambiguous. Use a longer fingerprint prefix. Matches include: ...`
- `Account selector cannot be combined with --platform or --type`

Expected refresh-family errors:

- `Account selector '<value>' not found`
- `Account selector '<value>' is ambiguous. Use a longer fingerprint prefix. Matches include: ...`
- `Stored provider credentials are missing for <account>`

Help copy should keep the family model explicit:

- bare `accounts` is for quick list access
- bare `accounts <selector>` is the canonical account detail surface
- `accounts view` is the explorer
- `accounts refresh` is the workflow command
- refresh uses credentials stored on accounts
- refresh never accepts API key flags
