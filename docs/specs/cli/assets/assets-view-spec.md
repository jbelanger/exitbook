# Assets CLI Spec

## Scope

This document defines the `assets` browse family:

- `exitbook assets`
- `exitbook assets list`
- `exitbook assets view <selector>`
- `exitbook assets explore [<selector>]`

It specializes the browse rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

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
| `assets list`               | Explicit alias of the same static list      | Static list        |
| `assets view <selector>`    | Focused inspection of one asset             | Static detail card |
| `assets explore`            | Full review explorer                        | TUI explorer       |
| `assets explore <selector>` | Explorer pre-selected on one asset          | TUI explorer       |
| Any of the above + `--json` | Machine output for the same semantic target | JSON               |

On a non-interactive terminal:

- `assets explore` falls back to the same static list as `assets`
- `assets explore <selector>` falls back to the same static detail as `assets view <selector>`

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

- root `assets <selector>` is invalid; callers must use `view <selector>` or `explore <selector>`
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
- processed transactions are used for historical asset knowledge, symbol resolution, and transaction counts, not for current quantity

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

- when `assets explore <selector>` directly targets a normally hidden asset on a TTY, the selected asset stays pinned in the default list so the explorer can open on that row

### Action-required filter

An asset is action-required when `requiresAssetReviewAction(...)` returns true.

Rules:

- excluded assets are never action-required
- stale confirmations are action-required
- reviewed assets can still be action-required when accounting remains blocked
- same-symbol ambiguity can keep an asset action-required even after review
  confirmation while at least one non-excluded conflicting alternative remains
- excluding every conflicting alternative clears same-symbol ambiguity from the
  surviving asset at read time

## Browse Surfaces

### Static List

Applies to:

- `exitbook assets`
- `exitbook assets list`
- `exitbook assets explore` off-TTY

Header:

```text
Assets {visible-or-total} · {flagged} flagged · {excluded} excluded
```

Action-required header:

```text
Review Queue {count} flagged {asset/assets} · {excluded} excluded
```

Table columns:

- `SYMBOL`
- `QUANTITY`
- `STATUS`
- `WHY`
- `ASSET ID`

Rules:

- static list output never shows controls, selected-row chrome, or a side-by-side detail panel
- user-facing status copy stays simplified and does not expose raw review or reference fields

### Static Detail

Applies to:

- `exitbook assets view <selector>`
- `exitbook assets explore <selector>` off-TTY

Body order:

1. title line with symbol, quantity, and optional badge
2. `Asset ID`
3. optional `Also seen as`
4. optional `Contract`
5. optional `CoinGecko`
6. optional repeated `Conflict asset`
7. optional `Why`
8. `Action`
9. optional `Inspect`
10. `Seen in`
11. optional `Signals`

Rules:

- static detail uses command-oriented action guidance, not TUI keybind wording
- same-symbol ambiguity on blockchain tokens renders `Contract`, `CoinGecko`, and full conflicting asset IDs under `Conflict asset`
- when the asset has transactions, detail surfaces show an exact `transactions list --asset-id ...` inspection hint
- signals are not artificially capped in static detail

### Explorer

Applies to:

- `exitbook assets explore`
- `exitbook assets explore <selector>`

The explorer is the primary interactive review surface.

Rules:

- `explore <selector>` preselects the requested asset
- filtered-empty explorer states stay in the explorer
- a truly empty unfiltered collection may collapse to the static empty state
- explorer detail may truncate for height, but the static detail card must remain complete

## JSON Contract

- `assets --json`, `assets list --json`, and `assets explore --json` return the same list payload shape
- `assets view <selector> --json` and `assets explore <selector> --json` return the same detail payload shape

List payload includes:

- `assets`
- `meta.total`
- `meta.actionRequiredCount`
- `meta.excludedCount`
- optional `meta.filters`

Detail payload includes one selected asset item with the same semantic fields used by the explorer and static detail card.

## Acceptance Notes

- `view` is static detail, never the explorer
- `explore` is the explorer verb
- root and `list` stay equivalent for static list output
- selector resolution must not diverge between `view` and `explore`
- browse commands never mutate asset review state
