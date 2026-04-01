# Balance CLI Spec

## Scope

The balance CLI is split into two explicit commands:

```text
exitbook balance view
exitbook balance refresh
```

This spec replaces the old `exitbook balance --offline` model.

Current implementation files:

- `apps/cli/src/features/balance/command/balance.ts`
- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/balance/command/balance-handler.ts`
- `apps/cli/src/features/balance/view/`

## Command Surface

### `exitbook balance view`

```text
exitbook balance view [--account-name <name> | --account-ref <ref>] [--json]
```

Purpose:

- inspect stored balance snapshots only
- never call live providers
- fail closed when the selected scope snapshot is missing, stale, building, or failed
- surface stored verification metadata, including unavailable verification warnings, when present

Options:

- `--account-name <name>`: view one requested account or child account by name
- `--account-ref <ref>`: view one requested account or child account by fingerprint prefix
- `--json`: emit machine-readable output instead of the TUI

Rules:

- child accounts resolve to the owning root balance scope
- when a child resolves upward, JSON includes `requestedAccount`
- the command must direct users to `exitbook balance refresh` when no fresh snapshot is readable

### `exitbook balance refresh`

```text
exitbook balance refresh [--account-name <name> | --account-ref <ref>] [--api-key <key>] [--api-secret <secret>] [--api-passphrase <passphrase>] [--json]
```

Purpose:

- rebuild calculated balances
- fetch live balances when available
- compare calculated vs live balances when verification is supported
- persist the refreshed snapshot

Options:

- `--account-name <name>`: refresh one requested account or child account by name
- `--account-ref <ref>`: refresh one requested account or child account by fingerprint prefix
- `--api-key`, `--api-secret`, `--api-passphrase`: optional exchange credentials override
- `--json`: emit machine-readable output instead of the TUI

Validation:

- `--api-key` and `--api-secret` must be provided together
- credential overrides require `--account-name` or `--account-ref`

Rules:

- this is the only balance command that hits live providers
- child accounts refresh their owning root balance scope
- when a child resolves upward, JSON includes both `requestedAccount` and the owning `account`

## `balance view` Behavior

### Read Model

`balance view` reads persisted snapshot rows and never derives current balances ad hoc.

Data sources:

- `balance_snapshots`
- `balance_snapshot_assets`
- scoped `projection_state` rows for `balances`

### Freshness Policy

`balance view` is fail-closed.

If the selected scope is:

- missing a snapshot
- marked `stale`
- marked `building`
- marked `failed`

the command returns an error with a concrete refresh hint.

Examples:

- root scope request:
  `Stored balance snapshot for scope account <ref> (...) is stale because ... Run "exitbook balance refresh --account-ref <ref>" to rebuild it.`
- child request:
  `Stored balance snapshot for scope account <ref> (...) is stale because ... Run "exitbook balance refresh --account-ref <requested-ref>" to rebuild it.`
- global invalidation from processed-transaction rebuild/reset:
  `Stored balance snapshot for scope account <ref> (...) is stale because processed transactions were rebuilt/reset, which invalidated stored balance snapshots for all scopes. Run "exitbook balance refresh" to rebuild all stored balances, or "exitbook balance refresh --account-ref <requested-ref>" to rebuild only the requested scope.`

### TUI Modes

Without an account selector:

- open an account-list TUI backed by stored snapshots
- each row shows one scope account and its stored asset count
- `Enter` drills into the stored asset list for that scope

With `--account-name` or `--account-ref`:

- open directly in stored asset mode for the resolved scope account

Stored snapshot asset mode:

- shows calculated balances only
- does not show live columns or comparison status
- keeps per-asset diagnostics from imported transactions

### JSON Output

Shape:

```json
{
  "success": true,
  "command": "balance-view",
  "data": {
    "accounts": [
      {
        "accountId": 5,
        "platformKey": "bitcoin",
        "accountType": "blockchain",
        "requestedAccount": {
          "id": 12,
          "platformKey": "bitcoin",
          "accountType": "blockchain"
        },
        "assets": [
          {
            "assetId": "blockchain:bitcoin:native",
            "assetSymbol": "BTC",
            "calculatedBalance": "1.25",
            "diagnostics": {
              "txCount": 4,
              "dateRange": {
                "earliest": "2025-01-01T00:00:00.000Z",
                "latest": "2025-01-20T00:00:00.000Z"
              },
              "totals": {
                "fees": "0.0001",
                "inflows": "1.5",
                "net": "1.25",
                "outflows": "0.2499"
              }
            }
          }
        ]
      }
    ]
  },
  "meta": {
    "mode": "view",
    "totalAccounts": 1,
    "filters": {
      "accountId": 12
    }
  }
}
```

Notes:

- `requestedAccount` is omitted when the requested account is the owning scope
- diagnostics are stored-read enrichment, not live provider data

## `balance refresh` Behavior

### Single Scope

When `--account-name` or `--account-ref` is provided:

- resolve the owning scope account
- rebuild the calculated snapshot if needed
- fetch live balances when supported
- compare calculated vs live balances when supported
- otherwise persist a calculated-only snapshot marked with unavailable verification metadata
- persist the snapshot

#### TUI

Single-scope refresh opens directly in verification asset mode.

Rows show:

- asset symbol
- calculated balance
- live balance
- match or diff status

Detail panel shows:

- transaction diagnostics
- unexplained delta when applicable

#### JSON

Shape:

```json
{
  "success": true,
  "command": "balance-refresh",
  "data": {
    "status": "warning",
    "balances": [],
    "summary": {},
    "coverage": {},
    "source": {
      "type": "blockchain",
      "name": "bitcoin",
      "address": "bc1..."
    },
    "account": {
      "id": 5,
      "type": "blockchain",
      "platformKey": "bitcoin",
      "identifier": "xpub..."
    },
    "requestedAccount": {
      "id": 12,
      "type": "blockchain",
      "platformKey": "bitcoin",
      "identifier": "bc1..."
    },
    "meta": {
      "timestamp": "2026-03-12T00:00:00.000Z",
      "streams": {}
    },
    "suggestion": "Run import again...",
    "partialFailures": [],
    "warnings": []
  }
}
```

### All Scopes

Without an account selector:

- load verifiable top-level accounts
- mark missing-credential accounts as skipped
- verify accounts sequentially
- update the TUI incrementally through the event relay

#### TUI

All-scopes refresh uses the verification dashboard.

Phases:

- initial account list with `pending` or `skipped`
- live verification phase with one `verifying` row
- completed summary with status-sorted rows

Account statuses:

- `pending`
- `verifying`
- `success`
- `warning`
- `failed`
- `skipped`
- `error`

#### JSON

Shape:

```json
{
  "success": true,
  "command": "balance-refresh",
  "data": {
    "accounts": []
  },
  "meta": {
    "totalAccounts": 6,
    "verified": 5,
    "skipped": 1,
    "matches": 4,
    "mismatches": 1,
    "timestamp": "2026-03-12T00:00:00.000Z"
  }
}
```

## Shared TUI Behavior

### Navigation

| Key               | Action           |
| ----------------- | ---------------- |
| `↑` / `k`         | Move cursor up   |
| `↓` / `j`         | Move cursor down |
| `PgUp` / `Ctrl-U` | Page up          |
| `PgDn` / `Ctrl-D` | Page down        |
| `Home`            | Jump to first    |
| `End`             | Jump to last     |
| `Enter`           | Drill down       |
| `Backspace`       | Drill up         |
| `q` / `Esc`       | Quit or drill up |

Rules:

- `Enter` only drills down from account lists
- `Backspace` only drills up from asset views entered from a parent account list
- `q` / `Esc` drill up first, then quit when already at the top level

### State Model

Current balance TUI states:

- `BalanceVerificationState`
- `BalanceStoredSnapshotState`
- `BalanceVerificationAssetState`
- `BalanceStoredSnapshotAssetState`

Key rule:

- asset states are discriminated by `mode`
- verification asset state owns `AssetComparisonItem[]`
- stored snapshot asset state owns `StoredSnapshotAssetItem[]`
- components must narrow by state mode instead of using type assertions

## Error Handling

The balance CLI must not silently degrade when required balance data cannot be trusted.

Rules:

- stale or missing stored snapshots fail closed in `balance view`
- diagnostics transaction-load failures propagate as errors
- snapshot persistence failures fail the refresh workflow
- refresh errors surface as account-level `error` entries in bulk JSON/TUI flows

## Non-Goals

- no `balance --offline` compatibility path
- no implicit live refresh during `balance view`
- no balance history UI in this command
