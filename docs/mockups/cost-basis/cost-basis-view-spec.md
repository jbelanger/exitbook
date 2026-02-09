# Cost Basis — Interactive TUI Spec

## Overview

`exitbook cost-basis` calculates cost basis and capital gains/losses, then presents results in an interactive TUI. It replaces the current console.log output with a browsable two-level interface.

Two entry modes:

- **Calculate mode** (default): Run calculation with method/jurisdiction/year params, then browse results. Params come from CLI flags or interactive prompts (same as today).
- **View mode** (`--calculation-id <id>`): Load a previous calculation from the database. No recomputation — instant load.

Both modes land on the same TUI. `--json` bypasses the TUI in either mode.

---

## Shared Behavior

### Two-Panel Layout

List (top) and detail panel (bottom), separated by a full-width dim `─` divider. Same as all other TUI views.

### Scrolling

When the list exceeds the visible height:

- Visible window scrolls to keep the selected row in view
- `▲` / `▼` dim indicators appear when more items exist above/below
- No explicit scroll bar

### Navigation

| Key               | Action           | When               |
| ----------------- | ---------------- | ------------------ |
| `↑` / `k`         | Move cursor up   | Always             |
| `↓` / `j`         | Move cursor down | Always             |
| `PgUp` / `Ctrl-U` | Page up          | Always             |
| `PgDn` / `Ctrl-D` | Page down        | Always             |
| `Home`            | Jump to first    | Always             |
| `End`             | Jump to last     | Always             |
| `Enter`           | Drill down       | Asset list only    |
| `Backspace`       | Back to assets   | Disposal list only |
| `q` / `Esc`       | Quit / Back      | See below          |

`Esc` behavior:

- Asset list: quit
- Disposal list (drilled-down): back to asset list

### Controls Bar

Bottom line, dim. Content adapts to current level.

### Loading State

Calculate mode:

```
⠋ Calculating cost basis...
```

View mode:

```
⠋ Loading cost basis results...
```

Brief spinner, then TUI appears.

### Error State

Transient error line appears below the detail panel, cleared on next navigation.

---

## Asset Summary (Level 1)

The default view after calculation completes. Shows per-asset aggregated gains/losses.

### Visual Example

```
Cost Basis (FIFO · CA · 2024 · CAD)  12 disposals · 4 assets
  Proceeds CAD 52,450.00 · Cost Basis CAD 38,200.00 · Gain/Loss +CAD 14,250.00 · Taxable +CAD 7,125.00

     BTC       3 disposals   proceeds CAD 28,400.00   basis CAD 20,100.00   +CAD 8,300.00
     ETH       5 disposals   proceeds CAD 15,200.00   basis CAD 12,800.00   +CAD 2,400.00
▸    SOL       2 disposals   proceeds CAD  6,350.00   basis CAD  3,800.00   +CAD 2,550.00
     PENDLE    2 disposals   proceeds CAD  2,500.00   basis CAD  3,000.00   -CAD   500.00

────────────────────────────────────────────────────────────────────────────────
▸ SOL  2 disposals · gain +CAD 2,550.00

  Proceeds:   CAD 6,350.00
  Cost Basis: CAD 3,800.00
  Gain/Loss: +CAD 2,550.00
  Taxable:   +CAD 1,275.00 (50% inclusion)

  Holding: avg 245 days · shortest 120d · longest 370d

  Press enter to view disposals

↑↓/j/k · ^U/^D page · Home/End · enter view disposals · q/esc quit
```

### Header

```
Cost Basis ({method} · {jurisdiction} · {taxYear} · {currency})  {disposalCount} disposals · {assetCount} assets
```

Line 2 — Financial summary:

```
  Proceeds {currency} {amount} · Cost Basis {currency} {amount} · Gain/Loss {sign}{currency} {amount} · Taxable {sign}{currency} {amount}
```

- Title: white/bold
- Method/jurisdiction/year/currency in parens: dim
- Disposal count: white
- Asset count: white
- `disposals` / `assets` labels: dim
- Dot separators: dim

Financial summary line:

- Labels (`Proceeds`, `Cost Basis`): dim
- Currency symbol: dim
- Amounts: white
- `Gain/Loss` label: dim
- Gain/loss amount: green (positive), red (negative)
- `Taxable` label: dim
- Taxable amount: green (positive), red (negative)

#### US Jurisdiction — Short/Long-Term Split

When jurisdiction is US, the financial summary uses two lines to show the short-term/long-term breakdown:

```
Cost Basis (FIFO · US · 2024 · USD)  12 disposals · 4 assets
  Proceeds USD 52,450.00 · Cost Basis USD 38,200.00 · Gain/Loss +USD 14,250.00
  Short-term +USD 2,200.00 · Long-term +USD 12,050.00
```

- `Short-term` / `Long-term` labels: dim
- Short-term amount: green (positive), red (negative)
- Long-term amount: green (positive), red (negative)

### Warning Bar

When transactions were excluded due to missing prices, a warning line appears between the header and the list:

```
  ⚠ 5 transactions excluded due to missing prices — run exitbook prices enrich
```

- `⚠`: yellow
- Warning text: yellow

### Asset List Columns

```
{cursor}  {asset}  {disposalCount} disposals  proceeds {currency} {proceeds}  basis {currency} {costBasis}  {sign}{currency} {gainLoss}
```

| Column     | Width    | Alignment | Content                     |
| ---------- | -------- | --------- | --------------------------- |
| Cursor     | 1        | —         | `▸` for selected, space     |
| Asset      | 10       | left      | Asset symbol                |
| Disposals  | 14       | right     | `{n} disposal(s)`           |
| Proceeds   | variable | right     | `proceeds {currency} {amt}` |
| Cost Basis | variable | right     | `basis {currency} {amt}`    |
| Gain/Loss  | variable | right     | `{sign}{currency} {amt}`    |

### Asset Row Colors

| Element           | Color |
| ----------------- | ----- |
| Asset symbol      | white |
| Disposal count    | white |
| `disposal(s)`     | dim   |
| `proceeds` label  | dim   |
| Proceeds amount   | white |
| `basis` label     | dim   |
| Cost basis amount | white |
| Currency symbols  | dim   |
| Gain (positive)   | green |
| Loss (negative)   | red   |

### Detail Panel (Asset Summary)

```
▸ {asset}  {disposalCount} disposals · gain/loss {sign}{currency} {amount}

  Proceeds:   {currency} {amount}
  Cost Basis: {currency} {amount}
  Gain/Loss:  {sign}{currency} {amount}
  Taxable:    {sign}{currency} {amount} ({taxRule})

  Holding: avg {days} days · shortest {days}d · longest {days}d

  Press enter to view disposals
```

For US jurisdiction, the detail panel shows the short/long-term breakdown:

```
▸ BTC  3 disposals · gain +USD 8,300.00

  Proceeds:   USD 28,400.00
  Cost Basis: USD 20,100.00
  Gain/Loss: +USD  8,300.00

  Short-term: +USD 2,200.00  (1 disposal)
  Long-term:  +USD 6,100.00  (2 disposals)

  Holding: avg 320 days · shortest 180d · longest 420d

  Press enter to view disposals
```

For Canadian jurisdiction:

```
▸ SOL  2 disposals · gain +CAD 2,550.00

  Proceeds:   CAD 6,350.00
  Cost Basis: CAD 3,800.00
  Gain/Loss: +CAD 2,550.00
  Taxable:   +CAD 1,275.00 (50% inclusion)

  Holding: avg 245 days · shortest 120d · longest 370d

  Press enter to view disposals
```

| Element                        | Color               |
| ------------------------------ | ------------------- |
| Asset symbol                   | white/bold          |
| Disposal count                 | white               |
| `disposals` / `gain/loss`      | dim                 |
| Gain/loss value                | green (+) / red (-) |
| Labels (`Proceeds:`, etc)      | dim                 |
| Currency                       | dim                 |
| Proceeds value                 | white               |
| Cost basis value               | white               |
| Taxable value                  | green (+) / red (-) |
| Tax rule in parens             | dim                 |
| `Short-term` / `Long-term`     | dim                 |
| Short/long-term amounts        | green (+) / red (-) |
| Short/long-term counts         | dim                 |
| `Holding:` label               | dim                 |
| Holding period values          | white               |
| `avg` / `shortest` / `longest` | dim                 |
| `Press enter...`               | dim                 |

### Sorting (Asset List)

Default: by absolute gain/loss descending (largest impact first).

---

## Disposal List (Level 2 — Drill-Down)

Activated by pressing `Enter` on an asset in the asset summary. Shows individual disposal events for that asset.

### Visual Example

```
Cost Basis  BTC  3 disposals · gain +CAD 8,300.00

▸  2024-03-15   0.2500 BTC   +CAD 4,100.00   365d
   2024-06-22   0.1500 BTC   +CAD 2,200.00   180d
   2024-09-10   0.1000 BTC   +CAD 2,000.00   420d

────────────────────────────────────────────────────────────────────────────────
▸ Disposal  2024-03-15  0.2500 BTC

  Proceeds:   CAD 12,500.00 (CAD 50,000.00/unit)
  Cost Basis: CAD  8,400.00 (CAD 33,600.00/unit)
  Gain/Loss: +CAD  4,100.00
  Taxable:   +CAD  2,050.00

  Lot: acquired 2023-03-10 · held 365 days
  Transactions: acquired #1234 · disposed #2456

↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

### US Jurisdiction Visual Example

```
Cost Basis  BTC  3 disposals · gain +USD 8,300.00

▸  2024-03-15   0.2500 BTC   +USD 4,100.00   365d  long-term
   2024-06-22   0.1500 BTC   +USD 2,200.00   180d  short-term
   2024-09-10   0.1000 BTC   +USD 2,000.00   420d  long-term

────────────────────────────────────────────────────────────────────────────────
▸ Disposal  2024-03-15  0.2500 BTC

  Proceeds:   USD 12,500.00 (USD 50,000.00/unit)
  Cost Basis: USD  8,400.00 (USD 33,600.00/unit)
  Gain/Loss: +USD  4,100.00

  Lot: acquired 2023-03-10 · held 365 days · long-term
  Transactions: acquired #1234 · disposed #2456

↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

### Header (Disposal List)

```
Cost Basis  {asset}  {disposalCount} disposals · gain/loss {sign}{currency} {amount}
```

- Title: white/bold
- Asset: white/bold
- Disposal count: white
- Gain/loss: green (+) / red (-)
- Labels: dim
- Dot separator: dim

### Disposal List Columns

```
{cursor}  {date}  {quantity} {asset}  {sign}{currency} {gainLoss}  {holdingDays}d  {taxCategory}
```

| Column       | Width    | Alignment | Content                             |
| ------------ | -------- | --------- | ----------------------------------- |
| Cursor       | 1        | —         | `▸` for selected, space otherwise   |
| Date         | 10       | left      | `YYYY-MM-DD`                        |
| Quantity     | 10       | right     | Locale-formatted                    |
| Asset        | 6        | left      | Asset symbol                        |
| Gain/Loss    | variable | right     | `{sign}{currency} {amount}`         |
| Holding      | 6        | right     | `{days}d`                           |
| Tax Category | 10       | left      | US only: `long-term` / `short-term` |

Tax category column only appears for US jurisdiction.

### Disposal Row Colors

| Element      | Color  |
| ------------ | ------ |
| Date         | dim    |
| Quantity     | green  |
| Asset        | white  |
| Gain (+)     | green  |
| Loss (-)     | red    |
| Currency     | dim    |
| Holding days | white  |
| `d` suffix   | dim    |
| `long-term`  | green  |
| `short-term` | yellow |

### Detail Panel (Disposal)

```
▸ Disposal  {date}  {quantity} {asset}

  Proceeds:   {currency} {amount} ({currency} {perUnit}/unit)
  Cost Basis: {currency} {amount} ({currency} {perUnit}/unit)
  Gain/Loss:  {sign}{currency} {amount}
  Taxable:    {sign}{currency} {amount}

  Lot: acquired {acquisitionDate} · held {holdingDays} days
  Transactions: acquired #{acquisitionTxId} · disposed #{disposalTxId}
```

For US jurisdiction, the lot line includes tax treatment:

```
  Lot: acquired {date} · held {days} days · {taxCategory}
```

For non-USD display currency, an FX conversion note appears:

```
  FX: USD → CAD at {fxRate} ({fxSource})
```

| Element                        | Color               |
| ------------------------------ | ------------------- |
| `Disposal` label               | white/bold          |
| Date                           | dim                 |
| Quantity                       | green               |
| Asset                          | white/bold          |
| Labels (`Proceeds:`, etc.)     | dim                 |
| Currency                       | dim                 |
| Proceeds value                 | white               |
| Per-unit values                | dim                 |
| Cost basis value               | white               |
| Gain/loss value                | green (+) / red (-) |
| Taxable value                  | green (+) / red (-) |
| `Lot:` label                   | dim                 |
| Acquisition date               | dim                 |
| Holding period                 | white               |
| `days` / `·`                   | dim                 |
| `long-term`                    | green               |
| `short-term`                   | yellow              |
| `Transactions:` label          | dim                 |
| Transaction IDs `#1234`        | white               |
| `acquired` / `disposed` labels | dim                 |
| `FX:` label                    | dim                 |
| FX rate                        | white               |
| FX source                      | dim                 |

### Sorting (Disposal List)

Default: by disposal date ascending (chronological order).

---

## Drill-Down Navigation

### Asset List → Disposal List

Press `Enter` on any asset row. The view transitions to the disposal list for that asset.

### Disposal List → Asset List

Press `Backspace` or `Esc`. Returns to asset list, restoring the previous cursor position.

### Controls Bar (Asset List)

```
↑↓/j/k · ^U/^D page · Home/End · enter view disposals · q/esc quit
```

### Controls Bar (Disposal List)

```
↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

---

## Filters

### Asset Filter (`--asset`)

Filters the asset list to show only the specified asset. When a single asset is filtered, the TUI lands directly on the disposal list (skips the asset summary level).

```bash
exitbook cost-basis --method fifo --jurisdiction CA --tax-year 2024 --asset BTC
```

### Calculation ID (`--calculation-id`)

Views a previous calculation without recomputing. Loads lots and disposals from the database.

```bash
exitbook cost-basis --calculation-id abc123-def456-...
```

---

## Empty States

### No Transactions

```
Cost Basis (FIFO · CA · 2024 · CAD)  0 disposals

  No transactions found in the date range 2024-01-01 to 2024-12-31.

  Import transactions first:
  exitbook import --exchange kraken --csv-dir ./exports/kraken

q quit
```

### No Disposals

```
Cost Basis (FIFO · CA · 2024 · CAD)  0 disposals · 245 lots created

  No disposals in this period — no capital gains or losses to report.

  245 acquisition lots were created from inflows in the date range.

q quit
```

### All Transactions Missing Prices

```
Cost Basis (FIFO · CA · 2024 · CAD)  error

  All transactions are missing price data.

  Run: exitbook prices enrich
  to populate prices before calculating cost basis.

q quit
```

### Calculation Not Found (--calculation-id)

```
Cost Basis  error

  Calculation not found: {id}

  List available calculations with --json and query the database.

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Preserves the existing JSON output shape for backward compatibility.

### Calculate Mode

```json
{
  "calculationId": "abc123-...",
  "method": "fifo",
  "jurisdiction": "CA",
  "taxYear": 2024,
  "currency": "CAD",
  "dateRange": {
    "startDate": "2024-01-01",
    "endDate": "2024-12-31"
  },
  "results": {
    "transactionsProcessed": 245,
    "assetsProcessed": ["BTC", "ETH", "SOL", "PENDLE"],
    "lotsCreated": 89,
    "disposalsProcessed": 12,
    "totalProceeds": "52450.00",
    "totalCostBasis": "38200.00",
    "totalGainLoss": "14250.00",
    "totalTaxableGainLoss": "7125.00"
  },
  "missingPricesWarning": "5 transactions were excluded due to missing prices."
}
```

### View Mode (`--calculation-id --json`)

Same shape, loaded from stored calculation data.

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning                |
| ---- | ------ | ---------------------- |
| `⚠`  | yellow | Missing prices warning |
| `▸`  | —      | Cursor (bold)          |

No per-row status icons — gain/loss color carries the signal.

**Content tier (what you read):**

| Element               | Color  |
| --------------------- | ------ |
| Asset symbols         | white  |
| Quantities            | green  |
| Gain (positive)       | green  |
| Loss (negative)       | red    |
| Proceeds amounts      | white  |
| Cost basis amounts    | white  |
| Disposal counts       | white  |
| Holding period values | white  |
| Transaction IDs       | white  |
| `long-term`           | green  |
| `short-term`          | yellow |
| Missing price warning | yellow |

**Context tier (recedes):**

| Element                                         | Color |
| ----------------------------------------------- | ----- |
| Method/jurisdiction/year/currency in header     | dim   |
| Dot separator `·`                               | dim   |
| Labels (`Proceeds:`, `Cost Basis:`, `Taxable:`) | dim   |
| Currency symbols (`CAD`, `USD`)                 | dim   |
| `proceeds` / `basis` in list rows               | dim   |
| `disposal(s)` / `assets` count labels           | dim   |
| Timestamps in disposal rows                     | dim   |
| Per-unit values in parens                       | dim   |
| `Lot:` / `Transactions:` labels                 | dim   |
| Acquisition/disposal date labels                | dim   |
| `d` suffix on holding days                      | dim   |
| `days` / `avg` / `shortest` / `longest`         | dim   |
| Tax rule in parens (`50% inclusion`)            | dim   |
| `Press enter to view disposals`                 | dim   |
| FX conversion note                              | dim   |
| Divider `─`                                     | dim   |
| Controls bar                                    | dim   |
| Scroll indicators                               | dim   |

---

## State Model

```typescript
/** Top-level: which view is active */
type CostBasisState = CostBasisAssetState | CostBasisDisposalState;

/** Asset summary level (default) */
interface CostBasisAssetState {
  view: 'assets';

  // Calculation context
  calculationId: string;
  method: string;
  jurisdiction: string;
  taxYear: number;
  currency: string;
  dateRange: { startDate: string; endDate: string };

  // Financial summary
  summary: {
    totalProceeds: string;
    totalCostBasis: string;
    totalGainLoss: string;
    totalTaxableGainLoss: string;
    // US only
    shortTermGainLoss?: string | undefined;
    longTermGainLoss?: string | undefined;
  };

  // Per-asset aggregates
  assets: AssetCostBasisItem[];
  totalDisposals: number;
  totalLots: number;

  // Warning
  missingPricesWarning?: string | undefined;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
}

/** Disposal list level (drill-down) */
interface CostBasisDisposalState {
  view: 'disposals';

  // Asset context
  asset: string;
  currency: string;
  jurisdiction: string;
  assetTotalGainLoss: string;

  // Disposal items
  disposals: DisposalViewItem[];

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Drill-down context (cursor position to restore)
  parentAssetIndex: number;

  error?: string | undefined;
}

/** Per-asset aggregate in asset list */
interface AssetCostBasisItem {
  asset: string;
  disposalCount: number;
  totalProceeds: string;
  totalCostBasis: string;
  totalGainLoss: string;
  totalTaxableGainLoss: string;
  isGain: boolean;

  // US jurisdiction
  shortTermGainLoss?: string | undefined;
  shortTermCount?: number | undefined;
  longTermGainLoss?: string | undefined;
  longTermCount?: number | undefined;

  // Holding period stats
  avgHoldingDays: number;
  shortestHoldingDays: number;
  longestHoldingDays: number;

  // Disposal data for drill-down
  disposals: DisposalViewItem[];
}

/** Individual disposal for disposal list */
interface DisposalViewItem {
  id: string;
  disposalDate: string;
  quantityDisposed: string;
  asset: string;

  proceedsPerUnit: string;
  totalProceeds: string;
  costBasisPerUnit: string;
  totalCostBasis: string;
  gainLoss: string;
  isGain: boolean;

  holdingPeriodDays: number;
  taxTreatmentCategory?: string | undefined; // US only

  // Lot context
  acquisitionDate: string;
  acquisitionTransactionId: number;
  disposalTransactionId: number;

  // FX conversion (non-USD currency)
  fxConversion?:
    | {
        fxRate: string;
        fxSource: string;
      }
    | undefined;
}
```

### Actions

```typescript
type CostBasisAction =
  // Navigation (both views)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Drill-down
  | { type: 'DRILL_DOWN' } // Enter on asset → disposal list
  | { type: 'DRILL_UP' } // Backspace/Esc → back to asset list

  // Error handling
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR'; error: string };
```

---

## Component Structure

```
CostBasisApp
├── AssetSummaryView (default level)
│   ├── CostBasisHeader (method, jurisdiction, year, currency, financial totals)
│   ├── WarningBar (missing prices, when present)
│   ├── AssetList
│   │   └── AssetRow
│   ├── Divider
│   ├── AssetDetailPanel (per-asset breakdown for selected)
│   ├── ErrorLine
│   └── ControlsBar
│
└── DisposalListView (drill-down level)
    ├── DisposalHeader (asset, disposal count, total gain/loss)
    ├── DisposalList
    │   └── DisposalRow
    ├── Divider
    ├── DisposalDetailPanel (proceeds, basis, lot info for selected)
    ├── ErrorLine
    └── ControlsBar
```

---

## Command Options

```
exitbook cost-basis [options]

Options:
  --method <method>              Calculation method: fifo, lifo, specific-id, average-cost
  --jurisdiction <code>          Tax jurisdiction: CA, US, UK, EU
  --tax-year <year>              Tax year for calculation (e.g., 2024)
  --fiat-currency <currency>     Fiat currency: USD, CAD, EUR, GBP
  --start-date <date>            Custom start date (YYYY-MM-DD, requires --end-date)
  --end-date <date>              Custom end date (YYYY-MM-DD, requires --start-date)
  --asset <symbol>               Filter to specific asset (lands on disposal list)
  --calculation-id <id>          View a previous calculation (no recomputation)
  --json                         Output JSON, bypass TUI
  -h, --help                     Display help
```

Notes:

- Interactive prompts still trigger when no method/jurisdiction/tax-year flags are provided (same behavior as today)
- `--calculation-id` skips both prompts and calculation — loads directly from DB
- `--asset` filters the result and skips straight to the disposal list for that asset

---

## Implementation Notes

### Data Flow (Calculate Mode)

1. Parse and validate CLI options at the boundary
2. If interactive (no flags): run prompt flow (jurisdiction, method, year, currency, dates)
3. Initialize database and repositories
4. Show spinner: "Calculating cost basis..."
5. Call `CostBasisHandler.execute(params)` — same as today
6. On success: load lots and disposals by calculation ID from `CostBasisRepository`
7. Aggregate disposals by asset (group by `assetSymbol` via lot join)
8. Compute per-asset summary: total proceeds, cost basis, gain/loss, taxable, holding period stats
9. For non-USD currency: load `CostBasisReport` with converted amounts
10. Render Ink TUI with computed view data
11. On quit: close database

### Data Flow (View Mode — `--calculation-id`)

1. Initialize database
2. Load calculation via `CostBasisRepository.findCalculationById(id)`
3. Validate calculation exists and is `completed`
4. Load lots via `CostBasisRepository.findLotsByCalculationId(id)`
5. Load disposals via `CostBasisRepository.findDisposalsByCalculationId(id)`
6. Same aggregation as calculate mode (steps 7–10)
7. Render TUI

### Disposal-to-Lot Join

Each `LotDisposal` has a `lotId` that references an `AcquisitionLot`. To show acquisition context in the disposal detail panel:

1. Load all lots for the calculation: `findLotsByCalculationId()`
2. Build a `Map<lotId, AcquisitionLot>` for O(1) lookup
3. Each disposal detail panel resolves its lot to show acquisition date, acquisition transaction ID

### Per-Asset Aggregation

Group disposals by the lot's `assetSymbol`. For each asset:

- Sum `totalProceeds`, `totalCostBasis`, `gainLoss` across all disposals
- Compute taxable based on jurisdiction rules (50% for CA, full for US)
- For US: split into short-term (≤365 days) vs long-term (>365 days)
- Compute holding period stats: average, min, max of `holdingPeriodDays`

### FX Conversion

When `currency !== 'USD'`, the `CostBasisReport` provides converted amounts. The TUI should:

- Display converted amounts as the primary values
- Show the FX conversion note in the disposal detail panel
- The `CostBasisReportGenerator` already handles this — reuse its output

### Terminal Size

- Asset list: fills available height minus fixed chrome (header ~4, warning ~1, divider 1, detail ~10, controls ~2, scroll indicators ~2 = ~20 lines)
- Disposal list: same layout, detail panel ~10 lines
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — gain/loss always shown with `+`/`-` sign prefix
- Tax treatment always shown as text (`long-term`/`short-term`), not just color
- Amounts always include currency prefix for clarity
