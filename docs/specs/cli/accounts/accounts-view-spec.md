# Accounts Browse Spec

## Scope

This document defines the accounts browse family:

- `exitbook accounts`
- `exitbook accounts <selector>`
- `exitbook accounts view`
- `exitbook accounts view <selector>`

It specializes the cross-command rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md). The V3 browse ladder is normative. This file defines what the accounts family renders on each surface.

## Command Shapes

| Shape                       | Meaning                                        | Human surface      |
| --------------------------- | ---------------------------------------------- | ------------------ |
| `accounts`                  | Quick browse of accounts in the active profile | Static list        |
| `accounts <selector>`       | Focused inspection of one account              | Static detail card |
| `accounts view`             | Full explorer                                  | TUI explorer       |
| `accounts view <selector>`  | Explorer pre-selected on one account           | TUI explorer       |
| Any of the above + `--json` | Machine output for the same semantic target    | JSON               |

On a non-interactive terminal:

- `accounts view` falls back to the same static list as `accounts`
- `accounts view <selector>` falls back to the same static detail card as `accounts <selector>`

`view` does not define a separate text schema or JSON schema.

## Selectors And Filters

### Bare selector

`<selector>` is a command-shape selector, not a generic filter flag.

Resolution order:

1. account name
2. unique fingerprint prefix

Behavior:

- bare selector misses fail with `Account selector '<value>' not found`
- bare selectors cannot be combined with `--account`, `--platform`, or `--type`
- bare selectors may target child accounts when the fingerprint prefix resolves to a child account

### Filter flags

Supported browse options:

- `--account <selector>`: filter by account name or unique fingerprint prefix
- `--platform <name>`: filter by platform key
- `--type <type>`: filter by account type (`blockchain`, `exchange-api`, `exchange-csv`)
- `--show-sessions`: include recent import session details in detail surfaces and JSON
- `--json`: output JSON

`--account` is a filter option, not a command-shape detail selector. For example, `accounts --account <selector>` still resolves to the static list surface, even if the filtered result is a single account.

## Shared Data Semantics

### Hierarchy

Accounts are rendered as top-level rows by default.

- top-level parents appear in list surfaces
- child accounts appear under `Derived addresses` in detail surfaces
- when the selected account is itself a child account, detail surfaces show that child directly

### Counts

Parent rows aggregate child import counts.

- a parent account's `Imports` value includes its own sessions plus child sessions
- `Derived addresses` rows show per-child import counts

Current header behavior:

- `total` counts every account in scope, including nested child accounts
- type counts summarize the displayed top-level rows

This means the `total` count can exceed the sum of the type counts when derived child accounts are present.

## Static List Surface

Applies to:

- `exitbook accounts`
- `exitbook accounts view` off-TTY

### Header

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

### Table

Static list output is a real headered table.

Columns:

| Column       | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `REF`        | First 10 characters of the account fingerprint                           |
| `NAME`       | Account name when present; otherwise the full display label              |
| `PLATFORM`   | Platform key                                                             |
| `TYPE`       | Account type                                                             |
| `IDENTIFIER` | Truncated identifier when the account has a separate name; otherwise `—` |

Example:

```text
Accounts 1 total · 1 blockchain

REF         NAME         PLATFORM      TYPE           IDENTIFIER
61637d8a6e  inj-wallet   injective     blockchain     inj1zk...pty4rau
```

Rules:

- no controls footer
- no quit hint
- no selected-row expansion
- no side-by-side detail panel
- every repeated field belongs to a declared header column
- child accounts do not appear as separate rows unless the query resolves directly to a child account

The static list intentionally omits import counts and projection / verification status to stay compact in scrollback.

### Empty states

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

## Static Detail Surface

Applies to:

- `exitbook accounts <selector>`
- `exitbook accounts view <selector>` off-TTY

### Header line

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
kraken-main 1234567890 kraken exchange-api
```

### Body

Field order:

1. `Name`
2. `Fingerprint`
3. `Identifier`
4. `Provider`
5. `Created`
6. `Verification` / `Projection`
7. optional `Last refresh`
8. optional `Imports`
9. optional `Derived addresses`
10. optional `Recent sessions`

Example:

```text
kraken-main 1234567890 kraken exchange-api

Name: kraken-main
Fingerprint: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
Identifier: acct-1
Provider: kraken-api
Created: 2026-01-01 00:00:00

Verification: ✓ verified · Projection: ✓ fresh
Last refresh: 2026-03-12 12:30:00
Imports: 2 imports
```

Optional sections:

- `Derived addresses ({n})`
- `Recent sessions`

Rules:

- child rows are capped at 5 visible lines, then `...and N more`
- session rows are capped at 5 visible lines, then `...and N more`
- no controls footer
- no quit hint
- no extra trailing blank line after the final rendered line

### Detail-specific display rules

- `Provider` shows `—` when unset
- `Identifier` uses the full display identifier stored in the view model
- `Imports` uses `N import` / `N imports`
- verification labels are `verified`, `warning`, `mismatch`, `unavailable`, `never checked`
- projection labels are `fresh`, `stale`, `building`, `failed`, `never built`

## Explorer Surface

Applies to:

- `exitbook accounts view`
- `exitbook accounts view <selector>`

The explorer is a master-detail Ink app.

### Layout

The explorer renders:

1. a blank line
2. the shared header
3. a blank line
4. a selectable account list
5. a divider
6. a fixed-height detail panel
7. a blank line
8. a controls bar

The header matches the static surface and adds `· sessions visible` when `--show-sessions` is set.

### List rows

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
▸ 1234567890 kraken       exchange-api  kraken-main acct-1  2 imports proj:fresh ver:ok
```

Status labels:

- projection: `fresh`, `stale`, `build`, `fail`, `—`, `?`
- verification: `ok`, `warn`, `fail`, `n/a`, `—`, `?`

### Detail panel

The explorer detail panel uses the same underlying fields as the static detail card, but:

- prefixes the title with `▸`
- is height-limited
- shows an overflow line when more detail exists than can fit

Overflow copy:

```text
... N more detail line(s). Rerun with --json for full details.
```

### Navigation

| Key               | Action            |
| ----------------- | ----------------- |
| `↑` / `k`         | Move up           |
| `↓` / `j`         | Move down         |
| `PgUp` / `Ctrl-U` | Page up           |
| `PgDn` / `Ctrl-D` | Page down         |
| `Home`            | Jump to first row |
| `End`             | Jump to last row  |
| `q` / `Esc`       | Quit              |

Controls bar:

```text
↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

### Empty explorer behavior

Explorer empties follow the V3 rules:

- `accounts view` with a truly empty unfiltered collection collapses to the static empty state
- filtered-empty explorer requests stay on the explorer code path instead of silently downgrading to static output
- selector misses fail before any renderer mounts

## JSON

JSON follows the same semantic target regardless of whether the command uses `view`.

- `accounts --json` and `accounts view --json` return the same list payload shape
- `accounts <selector> --json` and `accounts view <selector> --json` return the same detail payload shape

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

Inner list payload example:

```json
{
  "data": {
    "data": [
      {
        "id": 1,
        "accountFingerprint": "0000000000000000000000000000000000000000000000000000000000000001",
        "accountType": "exchange-api",
        "platformKey": "kraken",
        "name": "kraken-main",
        "identifier": "acct-1",
        "providerName": "kraken-api",
        "balanceProjectionStatus": "fresh",
        "lastCalculatedAt": "2026-03-12T12:00:00.000Z",
        "lastRefreshAt": "2026-03-12T12:30:00.000Z",
        "verificationStatus": "match",
        "sessionCount": 2,
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "meta": {
      "count": 1,
      "offset": 0,
      "limit": 1,
      "hasMore": false,
      "filters": {
        "platform": "kraken"
      }
    }
  }
}
```

Detail payload:

- the outer `command` field is `accounts` or `accounts-view`
- the inner `data` field is a single `AccountViewItem`
- the inner `meta.filters` includes the resolved selector filter under `account`

Notes:

- `sessions` is only populated when `--show-sessions` is passed
- `childAccounts` is nested under the selected account when child accounts exist
- there is no explorer-specific JSON envelope
- undefined properties are omitted from serialized JSON

## Errors And Help

Expected browse-family errors:

- `Use bare "accounts" instead of "accounts list".`
- `Account selector '<value>' not found`
- `Account selector '<value>' is ambiguous. Use a longer fingerprint prefix. Matches include: ...`
- `Account selector cannot be combined with --account, --platform, or --type`

Help copy should keep the V3 mental model explicit:

- bare `accounts` is for quick list and detail access
- `accounts view` is the explorer
- selectors are names or fingerprint prefixes
- `--json` is the only generic output override
