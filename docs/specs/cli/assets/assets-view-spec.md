---
last_verified: 2026-03-12
status: canonical
---

# Assets View CLI Specification

> ⚠️ **Code is law**: If this document disagrees with implementation, update the spec to match code.

How `exitbook assets view` assembles its read model, presents asset review state, and wires inline include/exclude and review actions.

## Quick Reference

| Concept                | Key Rule                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Command                | `exitbook assets view [--action-required] [--needs-review] [--json]`                     |
| Data sources           | Asset review projection, fresh balance snapshots, override store, processed transactions |
| Current quantity       | Comes from `balance_snapshot_assets`, not transaction recomputation                      |
| Freshness policy       | The view fails closed when any loaded balance scope snapshot is not fresh                |
| Excluded assets        | Remain visible in the view; exclusion does not hide them                                 |
| Action-required filter | Uses next-action logic, not review status alone                                          |

## Goals

- Provide the primary asset-first review and exclusion surface.
- Show review state, accounting impact, and exclusion state as separate concepts.
- Make current holdings visible without calling live providers.
- Keep inline review and exclusion actions fast inside the TUI.

## Non-Goals

- Fetching live balances.
- Hiding excluded assets from the browser.
- Recomputing current holdings from processed transactions.
- Replacing the asset-review projection with a second persisted review model.

## Definitions

### Asset View Item

```ts
interface AssetViewItem {
  assetId: string;
  assetSymbols: string[];
  accountingBlocked: boolean;
  confirmationIsStale: boolean;
  currentQuantity: string;
  evidence: AssetReviewEvidence[];
  evidenceFingerprint?: string | undefined;
  excluded: boolean;
  movementCount: number;
  referenceStatus: 'matched' | 'unmatched' | 'unknown';
  reviewStatus: 'clear' | 'needs-review' | 'reviewed';
  warningSummary?: string | undefined;
  transactionCount: number;
}
```

### Action-Required Asset

An asset is action-required when `requiresAssetReviewAction(...)` returns true.

Rules:

- Excluded assets are never action-required.
- Stale confirmations are action-required.
- Reviewed assets can still be action-required when accounting remains blocked.
- Same-symbol ambiguity can keep an asset action-required even after review confirmation.

### Accounting Display Status

```ts
type AssetAccountingDisplayStatus = 'allowed' | 'blocked' | 'excluded';
```

Derived from `accountingBlocked` plus `excluded`.

## Command Surface

### `exitbook assets view`

```text
exitbook assets view [--action-required] [--needs-review] [--json]
```

Purpose:

- browse asset review state
- inspect current held quantity
- inspect exclusion state
- drive review confirmation and exclusion toggles in the TUI

Options:

- `--action-required`: show only assets that currently require action
- `--needs-review`: alias for `--action-required`
- `--json`: emit machine-readable output instead of the TUI

Rules:

- `--action-required` and `--needs-review` are aliases
- `--json` returns a snapshot payload and never mounts Ink

## Read Model Assembly

`assets view` assembles one in-memory snapshot from four sources:

1. `balance_snapshots` and `balance_snapshot_assets`
2. `asset_review_*` projected summaries
3. override events for exclusion and review decisions
4. processed transactions for historical asset knowledge and symbol resolution

### Balance Snapshot Dependency

Before loading current holdings, the command:

- loads all persisted balance snapshots
- checks `balances` freshness for every loaded scope
- fails closed if any scope is `stale`, `building`, or `failed`

Error shape:

```text
Assets view requires fresh balance snapshots. Scope account #<id> is <status>: <reason>. Run "exitbook balance refresh --account-id <id>" or "exitbook balance refresh" to rebuild stored balances.
```

### Asset Universe

The displayed asset set is the union of:

- assets known from processed transactions
- assets currently held in balance snapshots
- assets present in asset-review summaries
- excluded asset ids from the override store

That means the view can still show:

- currently unheld assets with historical review or exclusion state
- held assets that never appeared in transaction-derived symbol scans

### Current Quantity

Current quantity is derived by grouping all `balance_snapshot_assets` rows by `assetId` and summing `calculatedBalance` across scopes.

Processed transactions are not used to recompute holdings.

## Filtering And Sorting

### Filter Modes

`assets view` has two filter modes:

- `all`
- `action-required`

`action-required` includes:

- `needs-review` assets
- `reviewed` assets that still block accounting
- stale confirmations that require re-confirmation

Excluded assets are filtered out of the action-required set.

### Sort Order

Assets are sorted by:

1. `needs-review`
2. `reviewed`
3. `excluded`
4. `clear`
5. descending `transactionCount`
6. ascending `assetId`

## TUI Behavior

### Header

The header shows:

- total asset count
- action-required count
- excluded count
- active filter

### List Row

Each row shows:

- review badge: `[review]`, `[stale]`, `[reviewed]`, or `[clear]`
- `[blocked]` when accounting is blocked and the asset is not excluded
- primary symbol
- current quantity
- reference status
- inclusion or exclusion state

### Detail Panel

The detail panel shows:

- primary symbol and asset id
- all known symbols
- current quantity
- review status
- reference status
- accounting status
- exclusion status
- next recommended action
- warning summary
- review evidence rows
- conflicting asset ids for ambiguity evidence when present

The evidence area has fixed height. Overflow is truncated with a `... N more evidence row(s)` line.

### Keyboard Actions

Controls:

- `↑↓` or `j/k`: move selection
- `tab`: toggle filter between `all` and `action-required`
- `x`: toggle exclude/include
- `c`: confirm review when the selected asset is `needs-review`
- `u`: clear review when the selected asset is `reviewed` or has a stale confirmation
- `q`: quit

## Mutation Semantics

The TUI delegates to the same handler logic used by the non-TUI commands.

### Exclusion Toggle

- `x` appends either `asset_exclude` or `asset_include`
- exclusion changes do not rebuild the asset-review projection
- exclusion affects accounting status immediately in the view state

### Confirm Review

- `c` appends `asset_review_confirm` with the current evidence fingerprint
- then invalidates and rereads `asset-review`
- the selected item updates from the rebuilt review summary

### Clear Review

- `u` appends `asset_review_clear`
- then invalidates and rereads `asset-review`
- the selected item updates from the rebuilt review summary

## JSON Output

`--json` returns:

```json
{
  "success": true,
  "command": "assets-view",
  "data": [
    {
      "assetId": "blockchain:ethereum:0xscam",
      "assetSymbols": ["SCAM"],
      "accountingBlocked": true,
      "confirmationIsStale": false,
      "currentQuantity": "100",
      "evidence": [],
      "evidenceFingerprint": "asset-review:v1:...",
      "excluded": false,
      "movementCount": 1,
      "referenceStatus": "matched",
      "reviewStatus": "needs-review",
      "warningSummary": "Provider flagged this token as spam",
      "transactionCount": 1
    }
  ],
  "meta": {
    "count": 1,
    "offset": 0,
    "limit": 1,
    "hasMore": false,
    "filters": {
      "actionRequired": true
    }
  }
}
```

Notes:

- `meta.filters.actionRequired` is present only when the action-required filter is active
- JSON returns the already filtered item set, not the full unfiltered asset universe

## Invariants

- **Required**: Current quantity comes from persisted balance snapshot assets.
- **Required**: Review state and exclusion state remain distinct in both row and detail rendering.
- **Required**: Excluded assets remain visible in the asset browser.
- **Required**: The action-required filter excludes already excluded assets.
- **Required**: `assets view` never calls live balance providers.

## Edge Cases And Gotchas

- A held asset that exists only in balance snapshots can still be selectable by symbol because symbol resolution merges transaction-known assets with current holdings.
- Same-symbol ambiguity can leave an asset accounting-blocked after review confirmation; the next action becomes excluding one conflicting contract.
- When no rows match the active filter, the TUI shows a friendly empty state rather than an empty table.

## Known Limitations (Current Implementation)

- The view loads all processed transactions to derive historical counts and symbol knowledge.
- Freshness is enforced across every loaded balance scope, so one stale scope blocks the whole asset browser.
- The evidence panel is fixed-height and truncates long evidence lists.

## Related Specs

- [Asset Review](../../asset-review.md)
- [Balance Projection](../../balance-projection.md)
- [Balance CLI](../balance/balance-view-spec.md)
- [CLI Surface V2](../cli-surface-v2-spec.md)

---

_Last updated: 2026-03-12_
