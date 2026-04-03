# Balance CLI Spec

## Scope

This document defines the browse-only `balance` command family:

```text
exitbook balance
exitbook balance <selector>
exitbook balance view
exitbook balance view <selector>
```

Live rebuild and verification are out of scope for `balance`. That workflow now lives under [Accounts CLI Spec](../accounts/accounts-view-spec.md) as `exitbook accounts refresh`.

Current implementation files:

- `apps/cli/src/features/balance/command/balance.ts`
- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-browse-command.ts`
- `apps/cli/src/features/balance/view/`

## Command Surface

### Root browse shapes

| Shape                       | Meaning                                        | Human surface |
| --------------------------- | ---------------------------------------------- | ------------- |
| `balance`                   | Quick browse of stored balance snapshots       | Static list   |
| `balance <selector>`        | Focused inspection of one stored balance scope | Static detail |
| `balance view`              | Stored balances explorer                       | TUI explorer  |
| `balance view <selector>`   | Explorer pre-selected on one scope             | TUI explorer  |
| Any of the above + `--json` | Machine output for the same semantic target    | JSON          |

On a non-interactive terminal:

- `balance view` falls back to the same static list as `balance`
- `balance view <selector>` falls back to the same static detail as `balance <selector>`

Refresh is not a `balance` subcommand.

## Purpose

`balance` exists to inspect stored snapshots only.

Rules:

- never call live providers
- fail closed when the selected scope snapshot is missing, stale, building, or failed
- surface stored verification metadata when present
- direct users to `exitbook accounts refresh` when a readable stored snapshot is unavailable

## Selectors And Resolution

`<selector>` may be an account name or a unique fingerprint prefix.

Rules:

- child requests resolve to the owning balance scope
- when a child resolves upward, JSON includes `requestedAccount`
- human detail remains anchored on the resolved stored balance scope

## Freshness Policy

`balance` is fail-closed.

If the selected scope is:

- missing a snapshot
- marked `stale`
- marked `building`
- marked `failed`

the command returns an error with a concrete rebuild hint.

Examples:

- root scope request:
  `Stored balance snapshot for scope account <ref> (...) is stale because ... Run "exitbook accounts refresh <ref>" to rebuild it.`
- child request:
  `Stored balance snapshot for scope account <ref> (...) is stale because ... Run "exitbook accounts refresh <requested-ref>" to rebuild it.`
- global invalidation from processed-transaction rebuild/reset:
  `Stored balance snapshot for scope account <ref> (...) is stale because processed transactions were rebuilt/reset, which invalidated stored balance snapshots for all scopes. Run "exitbook accounts refresh" to rebuild all stored balances, or "exitbook accounts refresh <requested-ref>" to rebuild only the requested scope.`

## Read Model

`balance` reads persisted snapshot rows and never derives current balances ad hoc.

Data sources:

- `balance_snapshots`
- `balance_snapshot_assets`
- scoped `projection_state` rows for `balances`

## Explorer Behavior

Without an account selector:

- open an account-list explorer backed by stored snapshots
- each row shows one scope account and its stored asset count
- `Enter` drills into the stored asset list for that scope

With an account selector:

- open directly in stored asset mode for the resolved scope account

Stored snapshot asset mode:

- shows calculated balances and stored verification fields only
- does not fetch or label current live balances
- keeps per-asset diagnostics derived from imported transactions

## JSON Output

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
              "txCount": 4
            }
          }
        ]
      }
    ]
  },
  "meta": {
    "mode": "view",
    "totalAccounts": 1,
    "selector": {
      "kind": "ref",
      "value": "2bc1c1d0aa"
    }
  }
}
```

Notes:

- `requestedAccount` is omitted when the requested account is the owning scope
- diagnostics are stored-read enrichment, not live provider data
- rebuild and verification JSON live under `accounts refresh`, not under `balance`
