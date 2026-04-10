# Accounts CLI Spec

## Scope

This document defines the `accounts` command family:

- `exitbook accounts`
- `exitbook accounts list`
- `exitbook accounts view <selector>`
- `exitbook accounts explore [<selector>]`
- `exitbook accounts refresh`
- `exitbook accounts refresh <selector>`

It specializes the browse and workflow rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- `accounts add`
- `accounts update`
- `accounts remove`

## Family Model

The `accounts` family has two responsibilities:

- browse stored account and balance data
- refresh stored balance snapshots and live verification results

Rules:

- browse commands are read-only and never call live providers
- refresh commands are workflow commands and may call live providers
- provider credentials are owned by stored account configuration, not by refresh flags
- exchange accounts imported from CSV may still store provider credentials for balance verification

## Command Surface

### Browse shapes

| Shape                         | Meaning                                               | Human surface      |
| ----------------------------- | ----------------------------------------------------- | ------------------ |
| `accounts`                    | Quick browse of accounts in the active profile        | Static list        |
| `accounts list`               | Explicit alias of the same static list                | Static list        |
| `accounts view <selector>`    | Focused inspection of one account and stored balances | Static detail card |
| `accounts explore`            | Full accounts explorer                                | TUI explorer       |
| `accounts explore <selector>` | Explorer pre-selected on one account                  | TUI explorer       |
| Any of the above + `--json`   | Machine output for the same semantic target           | JSON               |

On a non-interactive terminal:

- `accounts explore` falls back to the same static list as `accounts`
- `accounts explore <selector>` falls back to the same static detail as `accounts view <selector>`

### Refresh shapes

| Shape                         | Meaning                                                           | Human surface |
| ----------------------------- | ----------------------------------------------------------------- | ------------- |
| `accounts refresh`            | Refresh all eligible account balance scopes in the active profile | Text-progress |
| `accounts refresh <selector>` | Refresh one requested account's owning balance scope              | Text-progress |
| Any of the above + `--json`   | Machine output for the same workflow target                       | JSON          |

Refresh never prints the full account detail card. Users inspect refreshed data through the browse surfaces after the workflow completes.

## Selectors And Options

### Selector

`<selector>` resolves in this order:

1. exact account name
2. unique account fingerprint prefix, shown in the list as `ACCT-REF`

Rules:

- root `accounts <selector>` is invalid; callers must use `view <selector>` or `explore <selector>`
- selectors cannot be combined with `--platform` or `--type`
- selector misses fail with `Account selector '<value>' not found`
- child-account selectors are valid and may resolve to a parent-owned balance scope for balance data

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

## Shared Data Semantics

### Hierarchy And Counts

Accounts are rendered as top-level rows by default.

Rules:

- top-level parents appear in list surfaces
- child accounts appear under `Derived addresses` in detail surfaces
- when the selected account is itself a child account, detail surfaces show that child directly
- `Imports` includes the requested account's own sessions plus child sessions when applicable
- type counts summarize the displayed top-level rows
- `total` counts every account in scope, including nested child accounts

### Requested Account vs Balance Scope

Account detail is always anchored on the requested account.

Balance data may resolve to a different owning scope account when the selected account is a child account.

Rules:

- detail surfaces identify the requested account first
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
- missing or stale stored snapshots do not suppress the account detail card; the balance section renders the concrete reason and next step instead
- when no imported transaction data exists yet, the next step points users to `exitbook import` instead of `accounts refresh`

## Browse Surfaces

### Static List

Applies to:

- `exitbook accounts`
- `exitbook accounts list`
- `exitbook accounts explore` off-TTY

Header:

```text
Accounts{optional filter label} {total} total · {type counts...}
```

Table columns:

- `ACCT-REF`
- `NAME`
- `PLATFORM`
- `TYPE`
- `ASSETS`
- `IDENTIFIER`

Rules:

- `ASSETS` shows stored asset count when the owning balance scope is readable; otherwise `—`
- static output never shows controls, selected-row chrome, or side-by-side detail
- static list output is account-first and optimized for discovery, not navigation

### Static Detail

Applies to:

- `exitbook accounts view <selector>`
- `exitbook accounts explore <selector>` off-TTY

Body order:

1. title line with name, fingerprint prefix, platform, and type
2. `Account ref`
3. account identity and provider fields
4. `Imports`
5. optional `Derived addresses`
6. `Balances`

Rules:

- static detail is complete and should not arbitrarily cap derived addresses, sessions, or asset rows
- unreadable stored balance states render user-facing copy such as `No balance data yet` instead of implementation jargon
- detail copy stays user-facing and avoids terms like `projection` unless required for operator clarity

### Explorer

Applies to:

- `exitbook accounts explore`
- `exitbook accounts explore <selector>`

The explorer is a master-detail Ink app over the same account and stored-balance data.

Rules:

- `explore <selector>` preselects the requested account
- child selectors may open a child-scoped explorer when the requested child would not otherwise be visible in the top-level list
- `Enter` drills into stored asset balances
- filtered-empty explorer states stay in the explorer
- a truly empty unfiltered collection may collapse to the static empty state
- explorer detail may truncate for height, but the static detail card must remain complete

## Refresh Workflow

`accounts refresh` is a workflow command, not a browse surface.

Rules:

- progress is durable and line-oriented
- TTY-only activity indicators may appear while a step is in flight, but they are not the only feedback
- single-account refresh returns a terse workflow result, not a full detail card
- all-account refresh may report verified, skipped, warning, mismatch, and error outcomes per scope
- missing imported transaction data points users to `exitbook import` first

## JSON Contract

- `accounts --json`, `accounts list --json`, and `accounts explore --json` return the same list payload shape
- `accounts view <selector> --json` and `accounts explore <selector> --json` return the same detail payload shape
- `accounts refresh --json` and `accounts refresh <selector> --json` return workflow payloads, not browse payloads

List payload items include:

- account identity fields
- hierarchy summary fields
- stored balance summary fields
- optional sessions when `--show-sessions` is enabled

Detail payload extends the list item with:

- optional `requestedAccount`
- `balance`
- `sessions`

## Acceptance Notes

- `view` is static detail, never the explorer
- `explore` is the explorer verb
- root and `list` stay equivalent for static list output
- selector resolution must not diverge between `view` and `explore`
- browse commands never mutate balance state
