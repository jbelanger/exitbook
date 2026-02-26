# Prices View — Interactive TUI Spec

## Overview

`exitbook prices view` is a two-mode TUI for inspecting price coverage and resolving missing prices.

- **Coverage mode** (default): Asset-level table showing price coverage statistics per asset. Read-only detail panel.
- **Missing mode** (`--missing-only`): Movement-level list of transactions missing prices, with asset breakdown and inline set-price action.

Both modes share the same two-panel layout (list + detail), scrolling, and navigation. The columns, detail content, and available actions differ per mode.

`--json` bypasses the TUI in either mode.

---

## Shared Behavior

### Two-Panel Layout

All modes use a list (top) and detail panel (bottom), separated by a full-width dim `─` divider.

### Scrolling

When the list exceeds the visible height:

- Visible window scrolls to keep the selected row in view
- `▲` / `▼` dim indicators appear when more items exist above/below
- No explicit scroll bar

### Navigation

| Key               | Action                     | When                                      |
| ----------------- | -------------------------- | ----------------------------------------- |
| `↑` / `k`         | Move cursor up             | Always                                    |
| `↓` / `j`         | Move cursor down           | Always                                    |
| `PgUp` / `Ctrl-U` | Page up                    | Always                                    |
| `PgDn` / `Ctrl-D` | Page down                  | Always                                    |
| `Home`            | Jump to first              | Always                                    |
| `End`             | Jump to last               | Always                                    |
| `Enter`           | Drill into missing prices  | Coverage mode, selected asset has missing |
| `Esc`             | Go back to coverage / quit | Missing mode (drilled-in) / top-level     |
| `q`               | Quit                       | Always                                    |

### Controls Bar

Bottom line, dim. Content adapts to mode and selection state.

### Loading State

```
⠋ Loading price coverage...
```

Brief spinner, then TUI appears.

### Error State

Transient error line appears below the detail panel, cleared on next navigation.

---

## Coverage Mode

Default mode. Shows per-asset price coverage statistics. Read-only.

### Visual Example

```
Price Coverage  4 assets · 87.3% overall · 847 with price · 124 missing

  ✓  BTC       312       312         0      100.0%
  ✓  ETH       289       289         0      100.0%
▸ ⚠  SOL       142       122        20       85.9%
  ⚠  PENDLE    104        84        20       80.8%

────────────────────────────────────────────────────────────────────────────────
▸ SOL  142 transactions · 85.9% coverage

  With price:    122
  Missing price:  20

  Sources: kraken (89) · solana (53)
  Date range: 2023-06-12 to 2024-11-28

  Missing in: solana (14) · kraken (6)

↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

### Header

```
Price Coverage  {assetCount} assets · {overallCoverage} overall · {withPrice} with price · {missingPrice} missing
```

- Title: white/bold
- Asset count: white
- Coverage %: green (≥95%), yellow (70–95%), red (<70%)
- With price count: green
- Missing price count: yellow when > 0, green when 0
- Dot separators: dim

When filtered by asset:

```
Price Coverage (BTC)  100.0% coverage · 312 with price · 0 missing
```

### List Columns

```
{cursor} {icon}  {asset}  {total}  {withPrice}  {missing}  {coverage}
```

| Column     | Width | Alignment | Content                           |
| ---------- | ----- | --------- | --------------------------------- |
| Cursor     | 1     | —         | `▸` for selected, space otherwise |
| Icon       | 1     | —         | Status icon                       |
| Asset      | 10    | left      | Asset symbol                      |
| Total      | 8     | right     | Total transactions                |
| With Price | 8     | right     | Transactions with price           |
| Missing    | 8     | right     | Transactions missing price        |
| Coverage   | 8     | right     | `XX.X%`                           |

### Status Icons

| Condition        | Icon | Color  |
| ---------------- | ---- | ------ |
| 100% coverage    | `✓`  | green  |
| Partial coverage | `⚠`  | yellow |
| 0% coverage      | `✗`  | red    |

### Row Colors

| Row State         | Color                     |
| ----------------- | ------------------------- |
| Selected (cursor) | white/bold for entire row |
| 100% coverage     | normal white              |
| Partial coverage  | normal white, icon yellow |
| 0% coverage       | normal white, icon red    |

### Detail Panel

```
▸ {asset}  {total} transactions · {coverage} coverage

  With price:    {withPrice}
  Missing price: {missing}

  Sources: {source1} ({count1}) · {source2} ({count2})
  Date range: {earliest} to {latest}

  Missing in: {source1} ({count1}) · {source2} ({count2})
```

| Element                | Color                                     |
| ---------------------- | ----------------------------------------- |
| Asset                  | white/bold                                |
| Transaction count      | white                                     |
| Coverage %             | green (≥95%), yellow (70–95%), red (<70%) |
| Labels (`With price:`) | dim                                       |
| With price count       | green                                     |
| Missing price count    | yellow when > 0, green when 0             |
| Source names           | cyan                                      |
| Source counts          | white                                     |
| Date range             | dim                                       |
| `Missing in:` label    | dim                                       |
| Missing source names   | cyan                                      |
| Missing source counts  | yellow                                    |
| Dot separator `·`      | dim                                       |

- `Missing in:` line only appears when missing > 0
- Sources line shows which exchanges/blockchains have transactions for this asset

### Controls Bar

```
↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

When selected asset has missing prices:

```
↑↓/j/k · ^U/^D page · Home/End · enter view missing · q/esc quit
```

When selected asset has 100% coverage:

```
↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

Pressing Enter on an asset with missing prices drills into missing mode filtered to that asset.

### Sorting

Default: by coverage percentage ascending (worst coverage first), then by asset name.

---

## Drill-Down: Coverage → Missing

Pressing `Enter` on a coverage row with missing prices transitions to missing mode for that asset. This avoids quitting and re-launching with `--missing-only`.

### Behavior

1. **Enter** on asset with `missing_price > 0` → load missing movements for that asset → show missing mode
2. **Enter** on 100% asset → no-op
3. In drilled-in missing mode, **Esc** returns to coverage mode (with optimistically updated counts)
4. **q** quits entirely from any mode

### Header (Drilled-In)

```
← SOL Missing Prices  14 movements
```

Shows `←` breadcrumb indicator and asset name. No `across N assets` since it's filtered to one asset.

### Controls Bar (Drilled-In Missing)

```
↑↓/j/k · ^U/^D page · Home/End · s set price · esc back · q quit
```

Esc and q are separate: Esc goes back, q quits.

### Optimistic Count Updates

When returning to coverage mode via Esc, resolved prices are reflected:

- `missing_price` decremented by resolved count
- `with_price` incremented by resolved count
- Coverage percentage recalculated
- Summary totals updated

---

## Missing Mode

Activated by `--missing-only` or by drilling down from coverage mode. Shows individual movements that lack price data. Supports inline set-price action.

### Visual Example

```
Missing Prices  20 movements across 2 assets

  Asset Breakdown
    SOL     14 movements · 7 from solana · 7 from kraken
    PENDLE   6 movements · 6 from kraken

▸ ⚠  #2041  solana    2024-03-18 09:12  SOL       IN    12.5000
  ⚠  #2198  solana    2024-04-02 14:45  SOL       IN    25.0000
  ⚠  #2312  solana    2024-04-15 08:33  SOL       OUT    5.0000
  ⚠  #2456  kraken    2024-05-01 16:20  SOL       OUT    8.5000
  ⚠  #2589  kraken    2024-05-12 11:08  PENDLE    IN   150.0000
  ⚠  #2634  kraken    2024-05-18 09:30  PENDLE    OUT   75.0000

────────────────────────────────────────────────────────────────────────────────
▸ #2041  solana  transfer/deposit  2024-03-18 09:12:34
  Asset: SOL  IN  12.5000
  Price: missing

  Tip: Press 's' to set price, or use:
  exitbook prices set --asset SOL --date "2024-03-18T09:12:34Z" --price <amount>

↑↓/j/k · ^U/^D page · Home/End · s set price · q/esc quit
```

### Header

```
Missing Prices  {total} movements across {assetCount} assets
```

- Title: white/bold
- Movement count: yellow
- Asset count: white
- `across` / `movements`: dim

When filtered by source:

```
Missing Prices (kraken)  13 movements across 2 assets
```

### Asset Breakdown

Compact per-asset summary, shown between header and list:

```
  Asset Breakdown
    SOL     14 movements · 7 from solana · 7 from kraken
    PENDLE   6 movements · 6 from kraken
```

- Label `Asset Breakdown`: white/bold
- Asset symbols: white
- Movement counts: yellow
- Source names: cyan
- Source counts: white
- Dot separator `·`: dim
- Singular/plural: `1 movement` vs `14 movements`

### List Columns

```
{cursor} {icon}  #{txId}  {source}  {timestamp}  {asset}  {dir}  {amount}
```

| Column    | Width | Alignment | Content                           |
| --------- | ----- | --------- | --------------------------------- |
| Cursor    | 1     | —         | `▸` for selected, space otherwise |
| Icon      | 1     | —         | `⚠` yellow (all rows need prices) |
| TX ID     | 6     | right     | `#{id}` prefixed                  |
| Source    | 10    | left      | Exchange or blockchain name       |
| Timestamp | 16    | left      | `YYYY-MM-DD HH:MM`                |
| Asset     | 10    | left      | Asset symbol                      |
| Direction | 3     | left      | `IN` or `OUT`                     |
| Amount    | 12    | right     | Locale-formatted                  |

### Row Colors

| Element   | Color                                      |
| --------- | ------------------------------------------ |
| Icon `⚠`  | yellow                                     |
| TX ID     | white                                      |
| Source    | cyan                                       |
| Timestamp | dim                                        |
| Asset     | white                                      |
| `IN`      | green                                      |
| `OUT`     | yellow                                     |
| Amount    | green                                      |
| Set row   | green icon `✓`, dim text (after price set) |

### Detail Panel (Default)

```
▸ #{txId}  {source}  {operationCategory}/{operationType}  {fullTimestamp}
  Asset: {asset}  {direction}  {amount}
  Price: missing

  Tip: Press 's' to set price, or use:
  exitbook prices set --asset {asset} --date "{datetime}" --price <amount>
```

| Element         | Color      |
| --------------- | ---------- |
| TX ID           | white/bold |
| Source          | cyan       |
| Operation type  | dim        |
| Timestamp       | dim        |
| `Asset:` label  | dim        |
| Asset symbol    | white      |
| Direction `IN`  | green      |
| Direction `OUT` | yellow     |
| Amount          | green      |
| `Price:` label  | dim        |
| `missing`       | yellow     |
| `Tip:` label    | dim        |
| CLI command     | dim        |

### Detail Panel (After Price Set)

```
▸ #{txId}  {source}  {operationCategory}/{operationType}  {fullTimestamp}
  Asset: {asset}  {direction}  {amount}
  Price: {price} USD ✓

  Tip: Re-run `exitbook prices enrich` to propagate this price.
```

| Element     | Color |
| ----------- | ----- |
| Price value | green |
| `USD`       | dim   |
| `✓`         | green |
| Tip text    | dim   |

---

## Set-Price Action (Inline)

Available only in missing mode. The detail panel transforms into an inline input form — the list stays visible above.

### Trigger

Press `s` on any row that needs a price.

### Interaction Flow

1. **Press `s`** — detail panel transforms into input:

```
────────────────────────────────────────────────────────────────────────────────
▸ #2041  solana  SOL  IN  12.5000  2024-03-18 09:12:34

  Price (USD): █

↑↓ navigate · enter save · esc cancel
```

2. **User types price** — live validation:

```
────────────────────────────────────────────────────────────────────────────────
▸ #2041  solana  SOL  IN  12.5000  2024-03-18 09:12:34

  Price (USD): 142.50█

↑↓ navigate · enter save · esc cancel
```

3. **Press Enter** — saves price, row updates, cursor advances:

```
  ✓  #2041  solana    2024-03-18 09:12  SOL       IN    12.5000     ✓
▸ ⚠  #2198  solana    2024-04-02 14:45  SOL       IN    25.0000
```

4. **Cursor auto-advances** to the next row still needing a price.

### Input Field

| Element              | Color      |
| -------------------- | ---------- |
| Summary line         | white/bold |
| `Price (USD):` label | white      |
| Input text           | green      |
| Cursor `█`           | green      |
| Validation error     | red        |

### Validation

- Must be a positive number
- Validation message appears inline below the input:

```
  Price (USD): -5█
  ⚠ Price must be greater than 0
```

### Cancel

Press `Esc` during input to cancel — returns to normal detail panel view.

### After Save

- Row icon changes: `⚠` → `✓` (green)
- Row text dims (resolved)
- Header count decreases
- Asset breakdown counts update
- Cursor advances to next unresolved row
- If all resolved, detail panel shows completion message

### Controls Bar (During Input)

```
enter save · esc cancel
```

### Controls Bar (Normal)

```
↑↓/j/k · ^U/^D page · Home/End · s set price · q/esc quit
```

### Set-Price Data Flow

1. User enters price value
2. Call `PricesSetHandler.execute({ asset, date, price, currency: 'USD', source: 'manual-tui' })`
3. Handler saves to ManualPriceService + writes override event
4. On success: update local state (mark row as resolved)
5. On failure: show error below detail panel, revert to normal view

---

## Filters

### Source Filter (`--source`)

```bash
exitbook prices view --source kraken     # Only Kraken transactions
exitbook prices view --missing-only --source solana  # Missing prices on Solana
```

### Asset Filter (`--asset`)

```bash
exitbook prices view --asset BTC         # Coverage for BTC only
exitbook prices view --missing-only --asset SOL  # Missing SOL prices
```

### Missing Only (`--missing-only`)

```bash
exitbook prices view --missing-only      # Switch to missing mode
```

---

## Empty States

### No Transactions (Coverage Mode)

```
Price Coverage  0 assets

  No transaction data found.

  Import transactions first:
  exitbook import --exchange kucoin --csv-dir ./exports/kucoin

q quit
```

### Full Coverage (Coverage Mode)

```
Price Coverage  4 assets · 100.0% overall · 847 with price · 0 missing

  ✓  BTC       312       312         0      100.0%
  ✓  ETH       289       289         0      100.0%
  ✓  SOL       142       142         0      100.0%
  ✓  PENDLE    104       104         0      100.0%
```

Normal TUI with all rows showing `✓` — not a special empty state.

### No Missing Prices (Missing Mode)

```
Missing Prices  0 movements

  All transactions have price data.

  Run: exitbook prices enrich
  to keep prices up to date.

q quit
```

### No Transactions Matching Filter

```
Missing Prices (kraken)  0 movements

  No missing prices found for kraken.

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Output shape depends on mode.

### Coverage Mode

```json
{
  "data": {
    "coverage": [
      {
        "assetSymbol": "BTC",
        "total_transactions": 312,
        "with_price": 312,
        "missing_price": 0,
        "coverage_percentage": 100.0
      }
    ],
    "summary": {
      "total_transactions": 847,
      "with_price": 723,
      "missing_price": 124,
      "overall_coverage_percentage": 85.4
    }
  },
  "meta": {
    "total": 4,
    "filters": {}
  }
}
```

### Missing Mode (`--missing-only --json`)

```json
{
  "data": {
    "movements": [
      {
        "transactionId": 2041,
        "source": "solana",
        "datetime": "2024-03-18T09:12:34Z",
        "assetSymbol": "SOL",
        "direction": "inflow",
        "amount": "12.5000"
      }
    ],
    "assetBreakdown": [
      {
        "asset": "SOL",
        "count": 14,
        "sources": [
          { "name": "solana", "count": 7 },
          { "name": "kraken", "count": 7 }
        ]
      }
    ]
  },
  "meta": {
    "total": 20,
    "assets": 2,
    "filters": {}
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as ingestion dashboard and links-view.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning                  |
| ---- | ------ | ------------------------ |
| `✓`  | green  | Full coverage / resolved |
| `⚠`  | yellow | Missing prices           |
| `✗`  | red    | Zero coverage            |
| `▸`  | —      | Cursor (bold)            |

**Content tier (what you read):**

| Element                 | Color                                     |
| ----------------------- | ----------------------------------------- |
| Asset symbols           | white                                     |
| Amounts                 | green                                     |
| Source/blockchain names | cyan                                      |
| Coverage %              | green (≥95%), yellow (70–95%), red (<70%) |
| Counts (with price)     | green                                     |
| Counts (missing)        | yellow when > 0, green when 0             |
| Direction `IN`          | green                                     |
| Direction `OUT`         | yellow                                    |
| `missing` (price)       | yellow                                    |
| Set price value         | green                                     |

**Context tier (recedes):**

| Element                   | Color |
| ------------------------- | ----- |
| Timestamps                | dim   |
| Divider `─`               | dim   |
| Dot separator `·`         | dim   |
| Labels (`Price:`, `Tip:`) | dim   |
| Operation type in detail  | dim   |
| Controls bar              | dim   |
| Scroll indicators         | dim   |
| `across`, `movements`     | dim   |
| CLI command suggestions   | dim   |

---

## State Model

```typescript
/** Coverage mode state */
interface PricesViewCoverageState {
  mode: 'coverage';

  coverage: PriceCoverageInfo[];
  summary: {
    total_transactions: number;
    with_price: number;
    missing_price: number;
    overall_coverage_percentage: number;
  };

  selectedIndex: number;
  scrollOffset: number;

  assetFilter?: string | undefined;
  sourceFilter?: string | undefined;

  /** Set by reducer on Enter — picked up by useEffect to load missing data */
  drillDownAsset?: string | undefined;
}

/** Missing mode state */
interface PricesViewMissingState {
  mode: 'missing';

  movements: MissingPriceMovement[];
  assetBreakdown: AssetBreakdownEntry[];

  selectedIndex: number;
  scrollOffset: number;

  /** Tracks which rows have been resolved by inline set-price */
  resolvedRows: Set<string>; // key: `${txId}:${asset}:${direction}`

  /** Active inline input (undefined = not editing) */
  activeInput?:
    | {
        rowIndex: number;
        value: string;
        validationError?: string | undefined;
      }
    | undefined;

  assetFilter?: string | undefined;
  sourceFilter?: string | undefined;
  error?: string | undefined;

  /** When present, enables Esc-to-go-back to coverage mode */
  parentCoverageState?: PricesViewCoverageState | undefined;
}

type PricesViewState = PricesViewCoverageState | PricesViewMissingState;

/** A movement missing price data */
interface MissingPriceMovement {
  transactionId: number;
  source: string;
  datetime: string;
  assetSymbol: string;
  direction: 'inflow' | 'outflow';
  amount: string;
  operationCategory?: string | undefined;
  operationType?: string | undefined;
  /** Set after inline price entry */
  resolvedPrice?: string | undefined;
}

/** Per-asset breakdown in missing mode */
interface AssetBreakdownEntry {
  asset: string;
  count: number;
  sources: { name: string; count: number }[];
}
```

### Actions

```typescript
type PricesViewAction =
  // Navigation (both modes)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Missing mode — set price
  | { type: 'START_INPUT' }
  | { type: 'UPDATE_INPUT'; value: string }
  | { type: 'SUBMIT_PRICE' }
  | { type: 'CANCEL_INPUT' }
  | { type: 'PRICE_SAVED'; rowKey: string; price: string }
  | { type: 'PRICE_SAVE_FAILED'; error: string }

  // Drill-down: coverage → missing
  | { type: 'START_DRILL_DOWN' }
  | {
      type: 'DRILL_DOWN_COMPLETE';
      movements: MissingPriceMovement[];
      assetBreakdown: AssetBreakdownEntry[];
      asset: string;
      parentState: PricesViewCoverageState;
    }
  | { type: 'DRILL_DOWN_FAILED'; error: string }
  | { type: 'GO_BACK' }

  // Error handling
  | { type: 'CLEAR_ERROR' };
```

---

## Component Structure

```
PricesViewApp
├── Header (adapts to mode)
├── AssetBreakdown (missing mode only)
├── CoverageList (coverage mode) / MissingList (missing mode)
│   └── CoverageRow / MissingRow
├── Divider
├── CoverageDetailPanel (coverage mode) / MissingDetailPanel (missing mode)
│   └── PriceInputField (missing mode, when editing)
├── ErrorLine (transient, if present)
└── ControlsBar (adapts: 's' only in missing mode)
```

---

## Command Options

```
exitbook prices view [options]

Options:
  --source <name>      Filter by exchange or blockchain name
  --asset <currency>   Filter by specific asset (e.g., BTC, ETH)
  --missing-only       Show only movements missing price data (enables set-price)
  --json               Output JSON, bypass TUI
  -h, --help           Display help
```

---

## Implementation Notes

### Data Flow

**Coverage mode:**

1. Fetch all transactions from `TransactionRepository`
2. Calculate per-asset coverage via `ViewPricesHandler.execute()`
3. Render Ink TUI with coverage array in memory
4. No database writes — read-only mode

**Missing mode:**

1. Fetch transactions needing prices from `TransactionRepository.findTransactionsNeedingPrices()`
2. Extract individual movements missing prices (expand transactions to movement-level rows)
3. Build asset breakdown from movements
4. Render Ink TUI with movements in memory
5. On set-price: call `PricesSetHandler.execute()` which writes to DB + override store

### Terminal Size

- List panel: fills available height minus fixed chrome (header ~3, divider 1, detail ~6, controls ~2, scroll indicators ~2 = ~14 lines)
- Missing mode: asset breakdown adds ~3–5 lines above the list, reducing visible rows
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — icons and text labels always accompany colors
- Direction always shown as text (`IN`/`OUT`), not just color-coded

### Handler Enrichment for Missing Mode

The current `ViewPricesHandler` returns asset-level aggregates. Missing mode needs movement-level data:

1. Add `findMovementsMissingPrices()` to handler — returns individual movements without price data
2. Each movement includes: transaction ID, source, datetime, asset, direction, amount
3. Build asset breakdown by aggregating movements client-side
4. Source breakdown per asset: group by `source` field on the transaction
