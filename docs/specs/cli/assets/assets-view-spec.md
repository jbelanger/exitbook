# Assets CLI Spec

## Scope

This document defines the browse surface for the `assets` command family:

- `exitbook assets`
- `exitbook assets <selector>`
- `exitbook assets view`
- `exitbook assets view <selector>`

It specializes the browse-ladder rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- `assets confirm`
- `assets clear-review`
- `assets exclude`
- `assets include`
- `assets exclusions`

Those mutation commands remain part of the family, but this spec focuses on the read surface they support.

## Family Model

The `assets` family is the asset-first review and exclusion browse surface.

Rules:

- browse commands are read-only and never call live providers
- browse data comes from the asset-review projection, fresh stored balance snapshots, override state, and processed transactions
- current quantity comes from persisted balance snapshot assets, not transaction recomputation
- override-only exclusions do not create synthetic browse rows
- override-only exclusions remain discoverable through `assets exclusions`
- review and exclusion remain distinct concepts in both list and detail rendering

## Command Surface

### Browse shapes

| Shape                       | Meaning                                     | Human surface      |
| --------------------------- | ------------------------------------------- | ------------------ |
| `assets`                    | Quick browse of held or flagged assets      | Static list        |
| `assets <selector>`         | Focused inspection of one asset             | Static detail card |
| `assets view`               | Full review explorer                        | TUI explorer       |
| `assets view <selector>`    | Explorer pre-selected on one asset          | TUI explorer       |
| Any of the above + `--json` | Machine output for the same semantic target | JSON               |

On a non-interactive terminal:

- `assets view` falls back to the same static list as `assets`
- `assets view <selector>` falls back to the same static detail as `assets <selector>`

`view` does not define a separate text schema or JSON schema.

## Selectors And Options

### Selector

`<selector>` resolves in this order:

1. exact asset ID
2. unique symbol

Examples:

- `blockchain:ethereum:0xa0b8...`
- `USDC`
- `BTC`

Rules:

- exact asset ID resolution is case-sensitive
- symbol resolution is case-insensitive
- selectors cannot be combined with `--action-required`
- selectors cannot be combined with `--needs-review`
- selector misses fail clearly
- ambiguous symbol selectors fail and instruct the user to rerun with an exact asset ID

### Browse options

Supported browse options:

- `--action-required`: show only assets that still need operator action
- `--needs-review`: alias for `--action-required`
- `--json`: output JSON

## Shared Data Semantics

### Data sources

Browse data is assembled from:

1. `balance_snapshots` and `balance_snapshot_assets`
2. the asset-review projection
3. asset override state
4. processed transactions

Rules:

- the asset-review projection remains the canonical review-state source
- current quantity is derived from grouped `balance_snapshot_assets`
- processed transactions are used for historical asset knowledge and symbol resolution, not for live holdings

### Balance freshness

Assets browse is fail-closed on stored balance freshness.

Rules:

- all loaded top-level balance scopes must be fresh
- stale, building, or failed stored balance scopes block the entire browse surface
- freshness failures point users to `accounts refresh`
- processed-transaction rebuild invalidations explicitly call out that all stored balance snapshots were invalidated

### Asset universe

The displayed asset universe is the union of:

- assets known from processed transactions
- assets currently held in stored balance snapshots
- assets present in asset-review summaries

That means the family can show:

- currently unheld assets with historical review state
- held assets that exist only in stored balance snapshots
- assets whose symbols are still resolvable even when they were never seen in transaction-derived symbol scans

Override-only exclusions do not create synthetic rows in the main browse surface.

### Default filter

The default browse filter is holdings plus exceptions.

Visible by default:

- non-zero stored holdings
- excluded assets that also exist in holdings/history/review data
- any asset that currently requires review action

Hidden by default:

- zero-balance historical assets with no active exception

Exception:

- when `assets view <selector>` directly targets a normally hidden asset on a TTY, the selected asset stays pinned in the default list so the explorer can open on that row

### Action-required filter

An asset is action-required when `requiresAssetReviewAction(...)` returns true.

Rules:

- excluded assets are never action-required
- stale confirmations are action-required
- reviewed assets can still be action-required when accounting remains blocked
- same-symbol ambiguity can keep an asset action-required even after review confirmation

## Browse Surfaces

### Static list surface

Applies to:

- `exitbook assets`
- `exitbook assets view` off-TTY

#### Header

Default list:

```text
Assets {visible-or-total} · {flagged} flagged · {excluded} excluded
```

Action-required list:

```text
Review Queue {count} flagged {asset/assets} · {excluded} excluded
```

Rules:

- `Assets` or `Review Queue` is bold
- metadata is dim except the flagged count
- when the visible count differs from the total count, the header uses `{visible} of {total}`
- one blank line follows the header before the table or empty state

#### Table

Columns:

| Column     | Meaning                                                   |
| ---------- | --------------------------------------------------------- |
| `SYMBOL`   | Primary display symbol                                    |
| `QUANTITY` | Current stored quantity                                   |
| `STATUS`   | User-facing badge text (`Review`, `Reviewed`, `Excluded`) |
| `WHY`      | Plain-English review reason when present                  |
| `ASSET ID` | Exact asset identifier for follow-up commands             |

Rules:

- no controls footer
- no side-by-side detail panel
- no raw review status, reference status, or accounting status columns

### Static detail surface

Applies to:

- `exitbook assets <selector>`
- `exitbook assets view <selector>` off-TTY

#### Title line

Format:

```text
{symbol} {quantity} [optional badge]
```

Rules:

- symbol is bold
- quantity is dim
- badge uses the same user-facing labels as the explorer

#### Body

Field order:

1. `Asset ID`
2. optional `Also seen as`
3. optional `Contract`
4. optional `CoinGecko`
5. optional repeated `Conflict`
6. optional `Why`
7. `Action`
8. `Seen in`
9. optional `Signals` section

Rules:

- `Action` uses command-oriented guidance, not TUI keybind wording
- same-symbol ambiguity on blockchain tokens renders `Contract`, `CoinGecko`, and `Conflict`
- signals are not artificially capped in static detail

### Explorer surface

Applies to:

- `exitbook assets view`
- `exitbook assets view <selector>`

#### Header

Default list:

```text
Assets {visible} of {total} · {flagged} flagged · {excluded} excluded
```

When visible equals total, omit `of {total}`.

Action-required list:

```text
Review Queue {count} flagged {asset/assets} · {excluded} excluded
```

#### List rows

Each row shows:

- primary symbol
- current quantity
- optional badge: `[Review]`, `[Reviewed]`, or `[Excluded]`
- optional plain-English reason with a multi-signal hint such as `possible spam (+1 more)`

Rows do not show raw review status, reference status, accounting status, or inclusion labels.

#### Detail panel

The detail panel shows:

- title with symbol, quantity, and optional badge
- optional `Also seen as`
- optional `Contract` and `CoinGecko`
- optional repeated `Conflict`
- optional `Why`
- `Action` with keybind-based instructions
- `Seen in`
- optional `Signals`

Rules:

- the signals area has fixed height
- overflow truncates with `... N more signal(s)`
- `assets view <selector>` preselects the requested asset
- if the selected asset would otherwise be hidden by the default filter, it is pinned into the default list until the user changes filters

#### Keyboard actions

Controls:

- `↑↓` or `j/k`: move selection
- `tab`: toggle between default list and review queue
- `x`: toggle exclude/include
- `c`: mark reviewed when the selected asset is `needs-review`
- `u`: reopen review when the selected asset is `reviewed` or has a stale confirmation
- `q` or `esc`: quit

## JSON

### List output

List JSON uses the same semantic target for `assets` and `assets view`.

Payload:

- `data.assets`: the already filtered item set for the requested surface
- `metadata.total`: total asset universe count before the browse filter
- `metadata.actionRequiredCount`
- `metadata.excludedCount`
- optional `metadata.filters.actionRequired`

Rules:

- default JSON list output uses the same holdings-plus-exceptions filter as the human browse list
- action-required JSON list output returns only the action-required subset

### Detail output

Detail JSON uses the selected asset item directly.

Rules:

- `assets <selector> --json` and `assets view <selector> --json` return the same detail object
- detail JSON does not wrap the selected asset in an additional array

## Invariants

- current quantity comes from stored balance snapshot assets
- browse commands never call live balance providers
- override-only exclusions never synthesize browse rows
- action-required filtering excludes already excluded assets
- selector resolution follows exact asset ID before unique symbol

## Edge Cases

- a held asset that exists only in stored balance snapshots can still resolve by symbol
- same-symbol ambiguity can keep an asset accounting-blocked after review confirmation
- one stale stored balance scope blocks the whole browse family

## Related Specs

- [Asset Review](../../asset-review.md)
- [Balance Projection](../../balance-projection.md)
- [Accounts CLI](../accounts/accounts-view-spec.md)
- [CLI Surface V3](../cli-surface-v3-spec.md)
