# Cost Basis — Interactive TUI Spec

## Overview

`exitbook cost-basis` calculates cost basis and capital gains/losses, then presents results in an interactive TUI with a two-level drill-down.

- **Level 1 — Asset Summary**: Per-asset aggregated gains/losses.
- **Level 2 — Asset History**: Chronological timeline of all lot events (acquisitions, disposals, transfers) for the selected asset.

The timeline view replaces the previous disposal-only list, giving a complete picture of each asset's lifecycle — where it was acquired, how it moved, and when it was disposed.

Run calculation with method/jurisdiction/year params, then browse results. Params come from CLI flags or interactive prompts (same as today). `--json` bypasses the TUI.

---

## Design Decisions

### FX Conversion Semantics

All amounts display in the chosen display currency. Conversion date depends on event type:

- Acquisitions: FX rate at acquisition date
- Disposals: FX rate at disposal date
- Transfers: FX rate at transfer date

Because FX rates change over time, linked events can show different per-unit display amounts. This is expected behavior.

### FX Failure Contract

- Disposal conversion remains hard-fail (tax-critical).
- Lot/transfer conversion uses warn + USD fallback:
  - Set `fxUnavailable: true` and `originalCurrency: 'USD'` on affected items
  - Log a warning with asset, event id, date, and display currency
  - Render as `USD {amount}` with dim `(FX unavailable)` indicator
  - Include `fxUnavailable` in JSON output

### Timeline Sorting

Timeline events sort by full timestamp (`sortTimestamp`) ascending. For same timestamp, tiebreak by type: acquisition first, transfer second, disposal last.

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
| `Backspace`       | Back to assets   | Asset history only |
| `q` / `Esc`       | Quit / Back      | See below          |

`Esc` behavior:

- Asset list: quit
- Asset history (drilled-down): back to asset list

### Controls Bar

Bottom line, dim. Content adapts to current level.

### Loading State

```
⠋ Calculating cost basis...
```

Brief spinner, then TUI appears.

### Error State

Transient error line appears below the detail panel, cleared on next navigation.

### Quantity Formatting

All crypto quantities use a maximum of 8 decimal places with trailing zeros trimmed (minimum 2 decimal places). Amounts that round to zero at 8 decimal places display as `<0.00000001` to distinguish dust from true zero.

Examples:

| Raw Value                | Formatted      |
| ------------------------ | -------------- |
| `0.25000000000000000000` | `0.25`         |
| `1.50000000`             | `1.50`         |
| `0.00100000`             | `0.001`        |
| `0.00000112`             | `0.00000112`   |
| `0.000000000000014451`   | `<0.00000001`  |
| `123.45678912`           | `123.45678912` |

This keeps the list scannable while preserving meaningful precision.

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
▸ SOL  2 disposals · gain/loss +CAD 2,550.00

  Proceeds:   CAD 6,350.00
  Cost Basis: CAD 3,800.00
  Gain/Loss: +CAD 2,550.00
  Taxable:   +CAD 1,275.00 (50% inclusion)

  Lots: 5 acquired · 1 transfer
  Holding: avg 245 days · shortest 120d · longest 370d

  Press enter to view history

↑↓/j/k · ^U/^D page · Home/End · enter view history · q/esc quit
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

### Calculation Errors

When per-asset errors occur during calculation (e.g., insufficient acquisition lots), the affected assets are excluded from results and an error bar appears between the warning bar and the asset list:

```
  ✗ ALGO — Insufficient acquisition lots for disposal. Asset: ALGO, Disposal quantity: 0.00001, ...
```

- `✗` and text: red
- One line per failed asset
- Appears below the warning bar (if both present) and above the asset list
- Successfully processed assets display normally
- If ALL assets fail, an error-only empty state is shown with no asset list

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

  Lots: {lotCount} acquired · {transferCount} transfers
  Holding: avg {days} days · shortest {days}d · longest {days}d

  Press enter to view history
```

The "Lots" line shows acquisition and transfer counts to preview the asset's lifecycle before drilling down. Omit the transfer segment when there are zero transfers.

For US jurisdiction, the detail panel shows the short/long-term breakdown instead of Taxable:

```
▸ BTC  3 disposals · gain/loss +USD 8,300.00

  Proceeds:   USD 28,400.00
  Cost Basis: USD 20,100.00
  Gain/Loss: +USD  8,300.00

  Short-term: +USD 2,200.00  (1 disposal)
  Long-term:  +USD 6,100.00  (2 disposals)

  Lots: 8 acquired · 2 transfers
  Holding: avg 320 days · shortest 180d · longest 420d

  Press enter to view history
```

For Canadian jurisdiction:

```
▸ SOL  2 disposals · gain/loss +CAD 2,550.00

  Proceeds:   CAD 6,350.00
  Cost Basis: CAD 3,800.00
  Gain/Loss: +CAD 2,550.00
  Taxable:   +CAD 1,275.00 (50% inclusion)

  Lots: 5 acquired · 1 transfer
  Holding: avg 245 days · shortest 120d · longest 370d

  Press enter to view history
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
| `Lots:` label                  | dim                 |
| Lot/transfer counts            | white               |
| `acquired` / `transfers`       | dim                 |
| `Holding:` label               | dim                 |
| Holding period values          | white               |
| `avg` / `shortest` / `longest` | dim                 |
| `Press enter...`               | dim                 |

### Sorting (Asset List)

Default: by absolute gain/loss descending (largest impact first).

---

## Asset History (Level 2 — Timeline)

Activated by pressing `Enter` on an asset in the asset summary. Shows a chronological timeline of all lot events for that asset: acquisitions, disposals, and transfers.

This gives the complete lifecycle — where the asset was acquired, how it moved between accounts, and when it was sold.

### Event Types

| Type        | Marker | Meaning                                            |
| ----------- | ------ | -------------------------------------------------- |
| Acquisition | `+`    | New lot created (buy, receive, reward, airdrop)    |
| Disposal    | `−`    | Quantity sold/spent from a lot                     |
| Transfer    | `→`    | Cost basis carried between transactions via a link |

### Visual Example (Canadian)

```
Cost Basis  BTC  5 lots · 3 disposals · 1 transfer · gain/loss +CAD 8,300.00

  + 2023-02-09  acquired  0.25 BTC       basis CAD 8,400.00         #36023
  + 2023-04-15  acquired  0.15 BTC       basis CAD 5,730.00         #36045
  + 2023-06-10  acquired  0.10 BTC       basis CAD 4,200.00         #36052
  → 2023-08-01  transfer  0.05 BTC       basis CAD 1,680.00         #36023 → #36067
▸ − 2024-03-15  disposed  0.25 BTC      +CAD 4,100.00  held 365d   #36109
  − 2024-06-22  disposed  0.15 BTC      +CAD 2,200.00  held 180d   #36110
  + 2024-07-01  acquired  0.30 BTC       basis CAD 25,200.00        #36120
  − 2024-09-10  disposed  0.10 BTC      +CAD 2,000.00  held 420d   #36130

────────────────────────────────────────────────────────────────────────────────
▸ Disposal  2024-03-15  0.25 BTC

  Proceeds:   CAD 12,500.00 (CAD 50,000.00/unit)
  Cost Basis: CAD  8,400.00 (CAD 33,600.00/unit)
  Gain/Loss: +CAD  4,100.00
  Taxable:   +CAD  2,050.00

  Lot: acquired 2023-02-09 · held 365 days
  Transactions: acquired #36023 · disposed #36109
  FX: USD → CAD at 1.3581 (bank-of-canada)

↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

### Visual Example (US)

```
Cost Basis  BTC  3 lots · 3 disposals · gain/loss +USD 8,300.00

  + 2023-02-09  acquired  0.25 BTC       basis USD 6,200.00         #1234
  + 2023-04-15  acquired  0.15 BTC       basis USD 4,200.00         #1245
  + 2023-06-10  acquired  0.10 BTC       basis USD 3,100.00         #1260
▸ − 2024-03-15  disposed  0.25 BTC      +USD 4,100.00  held 365d   #2456  long-term
  − 2024-06-22  disposed  0.15 BTC      +USD 2,200.00  held 180d   #2501  short-term
  − 2024-09-10  disposed  0.10 BTC      +USD 2,000.00  held 420d   #2580  long-term

────────────────────────────────────────────────────────────────────────────────
▸ Disposal  2024-03-15  0.25 BTC

  Proceeds:   USD 12,500.00 (USD 50,000.00/unit)
  Cost Basis: USD  8,400.00 (USD 33,600.00/unit)
  Gain/Loss: +USD  4,100.00

  Lot: acquired 2023-02-09 · held 365 days · long-term
  Transactions: acquired #1234 · disposed #2456

↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

### Visual Example (Dust Disposals)

Many tiny disposals (e.g., staking reward dust) format cleanly with the quantity rules:

```
Cost Basis  BTC  8 lots · 15 disposals · gain/loss +CAD 0.08

  + 2023-02-09  acquired  0.001 BTC         basis CAD 38.20           #36023
  + 2023-03-15  acquired  0.00000112 BTC     basis CAD 0.04            #36045
  + 2023-04-01  acquired  0.00000131 BTC     basis CAD 0.05            #36050
▸ − 2023-11-28  disposed  <0.00000001 BTC   +CAD 0.00  held 292d      #36109
  − 2023-11-28  disposed  <0.00000001 BTC   +CAD 0.00  held 276d      #36109
  − 2023-11-28  disposed  0.00000112 BTC    +CAD 0.02  held 221d      #36109
  − 2023-11-28  disposed  0.00000131 BTC    +CAD 0.02  held 220d      #36109

────────────────────────────────────────────────────────────────────────────────
▸ Disposal  2023-11-28  <0.00000001 BTC

  Proceeds:   CAD 0.00 (CAD 51,385.93/unit)
  Cost Basis: CAD 0.00 (CAD 37,458.69/unit)
  Gain/Loss: +CAD 0.00

  Lot: acquired 2023-02-09 · held 292 days
  Transactions: acquired #36023 · disposed #36109
  FX: USD → CAD at 1.3581 (bank-of-canada)

↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

### Header (Asset History)

```
Cost Basis  {asset}  {lotCount} lots · {disposalCount} disposals · {transferCount} transfers · gain/loss {sign}{currency} {amount}
```

Omit the transfer segment when there are zero transfers. Omit the lots segment when zero (shouldn't happen, but defensive).

- Title: white/bold
- Asset: white/bold
- Counts: white
- `lots` / `disposals` / `transfers` labels: dim
- Gain/loss: green (+) / red (-)
- Labels: dim
- Dot separator: dim

### Timeline Row Format

Each event type has a distinct row layout. All share the same column grid for alignment.

**Acquisition row:**

```
{cursor} + {date}  acquired  {quantity} {asset}  basis {currency} {totalCostBasis}  #{txId}
```

**Disposal row:**

```
{cursor} − {date}  disposed  {quantity} {asset}  {sign}{currency} {gainLoss}  held {days}d  #{txId}  {taxCategory}
```

**Transfer row:**

```
{cursor} → {date}  transfer  {quantity} {asset}  basis {currency} {totalCostBasis}  #{sourceTxId} → #{targetTxId}
```

When `fxUnavailable` is set on acquisition/transfer events, render value as:

```
basis USD {totalCostBasis} (FX unavailable)
```

| Column       | Width    | Alignment | Content                                      |
| ------------ | -------- | --------- | -------------------------------------------- |
| Cursor       | 1        | —         | `▸` for selected, space otherwise            |
| Marker       | 1        | —         | `+` / `−` / `→`                              |
| Date         | 10       | left      | `YYYY-MM-DD`                                 |
| Type         | 10       | left      | `acquired` / `disposed` / `transfer`         |
| Quantity     | variable | right     | Formatted quantity + asset symbol            |
| Value        | variable | right     | Varies by type (see below)                   |
| Holding      | 8        | right     | Disposal only: `held {days}d`                |
| Transaction  | variable | right     | `#{id}` or `#{id} → #{id}`                   |
| Tax Category | 10       | left      | US disposal only: `long-term` / `short-term` |

Value column by event type:

- **Acquisition**: `basis {currency} {totalCostBasis}` — total cost basis of the lot
- **Disposal**: `{sign}{currency} {gainLoss}` — capital gain or loss
- **Transfer**: `basis {currency} {totalCostBasis}` — cost basis carried over

### Timeline Row Colors

| Element                | Color  |
| ---------------------- | ------ |
| `+` marker             | green  |
| `−` marker             | red    |
| `→` marker             | cyan   |
| Date                   | dim    |
| Type label             | dim    |
| Quantity (acquisition) | green  |
| Quantity (disposal)    | white  |
| Quantity (transfer)    | cyan   |
| Asset symbol           | white  |
| `basis` label          | dim    |
| Basis amount           | white  |
| Gain (+)               | green  |
| Loss (−)               | red    |
| `held` label           | dim    |
| Holding days           | white  |
| `d` suffix             | dim    |
| Transaction IDs        | dim    |
| `→` between tx IDs     | dim    |
| `long-term`            | green  |
| `short-term`           | yellow |

Selected row: entire row is bold with `▸` cursor.

### Detail Panels

The detail panel below the divider adapts to the selected event type.

#### Acquisition Detail

```
▸ Acquisition  {date}  {quantity} {asset}

  Cost Basis: {currency} {totalCostBasis} ({currency} {perUnit}/unit)
  Status:     {status} · {remainingQuantity} remaining

  Transaction: #{acquisitionTxId}
```

For non-USD display currency, show:

```
  FX: USD → {currency} at {fxRate} ({fxSource})
```

When historical FX is unavailable for this lot, show:

```
  Cost Basis: USD {totalCostBasis} (USD {perUnit}/unit)
  FX: unavailable for {date} ({currency})  [fallback]
```

Status values:

- `open` — full quantity still available
- `partially disposed` — some quantity consumed by disposals
- `fully disposed` — entire lot consumed

| Element                      | Color      |
| ---------------------------- | ---------- |
| `Acquisition` label          | white/bold |
| Date                         | dim        |
| Quantity                     | green      |
| Asset                        | white/bold |
| Labels (`Cost Basis:`, etc.) | dim        |
| Currency                     | dim        |
| Cost basis value             | white      |
| Per-unit value               | dim        |
| `open`                       | green      |
| `partially disposed`         | yellow     |
| `fully disposed`             | dim        |
| Remaining quantity           | white      |
| Transaction ID               | white      |

#### Disposal Detail

Same as previous spec, with minor formatting improvements:

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
  FX: USD → {currency} at {fxRate} ({fxSource})
```

| Element                        | Color               |
| ------------------------------ | ------------------- |
| `Disposal` label               | white/bold          |
| Date                           | dim                 |
| Quantity                       | white               |
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
| Transaction IDs                | white               |
| `acquired` / `disposed` labels | dim                 |
| `FX:` label                    | dim                 |
| FX rate                        | white               |
| FX source                      | dim                 |

#### Transfer Detail

```
▸ Transfer  {date}  {quantity} {asset}

  Cost Basis: {currency} {totalCostBasis} ({currency} {perUnit}/unit)
  Source lot:  acquired {sourceAcquisitionDate}
  Transactions: #{sourceTransactionId} → #{targetTransactionId}
```

For non-USD display currency, show:

```
  FX: USD → {currency} at {fxRate} ({fxSource})
```

When historical FX is unavailable for this transfer, show:

```
  Cost Basis: USD {totalCostBasis} (USD {perUnit}/unit)
  FX: unavailable for {date} ({currency})  [fallback]
```

When the transfer incurred a crypto fee:

```
  Fee: USD {feeUsdValue}
```

| Element                      | Color      |
| ---------------------------- | ---------- |
| `Transfer` label             | white/bold |
| Date                         | dim        |
| Quantity                     | cyan       |
| Asset                        | white/bold |
| Labels (`Cost Basis:`, etc.) | dim        |
| Currency                     | dim        |
| Cost basis value             | white      |
| Per-unit value               | dim        |
| Source acquisition date      | dim        |
| Transaction IDs              | white      |
| `→` between tx IDs           | dim        |
| Fee value                    | white      |

### Sorting (Timeline)

Default: by full event timestamp ascending (`sortTimestamp`, chronological to sub-day precision). Events on the same timestamp sort by type: acquisitions first, transfers second, disposals last.

---

## Drill-Down Navigation

### Asset List → Asset History

Press `Enter` on any asset row. The view transitions to the asset history timeline.

### Asset History → Asset List

Press `Backspace` or `Esc`. Returns to asset list, restoring the previous cursor position.

### Controls Bar (Asset List)

```
↑↓/j/k · ^U/^D page · Home/End · enter view history · q/esc quit
```

### Controls Bar (Asset History)

```
↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

---

## Filters

### Asset Filter (`--asset`)

Filters the asset list to show only the specified asset. When a single asset is filtered, the TUI lands directly on the asset history timeline (skips the asset summary level).

```bash
exitbook cost-basis --method fifo --jurisdiction CA --tax-year 2024 --asset BTC
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

---

## JSON Mode (`--json`)

Bypasses the TUI. Outputs calculation results in JSON format.

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
  "summary": {
    "transactionsProcessed": 245,
    "assetsProcessed": ["BTC", "ETH", "SOL", "PENDLE"],
    "lotsCreated": 89,
    "disposalsProcessed": 12,
    "totalProceeds": "52450.00",
    "totalCostBasis": "38200.00",
    "totalGainLoss": "14250.00",
    "totalTaxableGainLoss": "7125.00"
  },
  "assets": [
    {
      "asset": "BTC",
      "lots": [
        {
          "id": "lot-1",
          "costBasisPerUnit": "42000.00",
          "totalCostBasis": "8400.00",
          "fxUnavailable": true,
          "originalCurrency": "USD"
        }
      ],
      "disposals": [...],
      "transfers": [
        {
          "id": "transfer-1",
          "totalCostBasis": "1680.00",
          "fxUnavailable": true,
          "originalCurrency": "USD"
        }
      ]
    }
  ],
  "missingPricesWarning": "5 transactions were excluded due to missing prices."
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning                  |
| ---- | ------ | ------------------------ |
| `⚠`  | yellow | Missing prices warning   |
| `✗`  | red    | Per-asset calc error     |
| `▸`  | —      | Cursor (bold)            |
| `+`  | green  | Acquisition event marker |
| `−`  | red    | Disposal event marker    |
| `→`  | cyan   | Transfer event marker    |

**Content tier (what you read):**

| Element                    | Color  |
| -------------------------- | ------ |
| Asset symbols              | white  |
| Quantities (acquired)      | green  |
| Quantities (disposed)      | white  |
| Quantities (transferred)   | cyan   |
| Gain (positive)            | green  |
| Loss (negative)            | red    |
| Proceeds amounts           | white  |
| Cost basis amounts         | white  |
| Disposal/lot/transfer cnts | white  |
| Holding period values      | white  |
| Transaction IDs            | white  |
| `long-term`                | green  |
| `short-term`               | yellow |
| `open` lot status          | green  |
| `partially disposed`       | yellow |
| `fully disposed`           | dim    |
| Missing price warning      | yellow |
| `(FX unavailable)` marker  | dim    |

**Context tier (recedes):**

| Element                                          | Color |
| ------------------------------------------------ | ----- |
| Method/jurisdiction/year/currency in header      | dim   |
| Dot separator `·`                                | dim   |
| Labels (`Proceeds:`, `Cost Basis:`, `Taxable:`)  | dim   |
| Currency symbols (`CAD`, `USD`)                  | dim   |
| `proceeds` / `basis` in list rows                | dim   |
| `disposal(s)` / `assets` count labels            | dim   |
| `lots` / `transfers` count labels                | dim   |
| Event type labels (`acquired`, `disposed`, etc.) | dim   |
| Dates in timeline rows                           | dim   |
| Per-unit values in parens                        | dim   |
| `Lot:` / `Transactions:` / `Source lot:` labels  | dim   |
| `acquired` / `disposed` labels in detail         | dim   |
| `held` label and `d` suffix                      | dim   |
| `days` / `avg` / `shortest` / `longest`          | dim   |
| Tax rule in parens (`50% inclusion`)             | dim   |
| `Press enter to view history`                    | dim   |
| FX conversion note                               | dim   |
| Transaction IDs in timeline rows                 | dim   |
| `→` between transaction IDs                      | dim   |
| Divider `─`                                      | dim   |
| Controls bar                                     | dim   |
| Scroll indicators                                | dim   |

---

## State Model

```typescript
/** Top-level: which view is active */
type CostBasisState = CostBasisAssetState | CostBasisTimelineState;

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

  // Calculation errors (partial failure)
  calculationErrors?: { asset: string; error: string }[] | undefined;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
}

/** Asset history timeline level (drill-down) */
interface CostBasisTimelineState {
  view: 'timeline';

  // Asset context
  asset: string;
  currency: string;
  jurisdiction: string;
  assetTotalGainLoss: string;

  // Event counts
  lotCount: number;
  disposalCount: number;
  transferCount: number;

  // Unified chronological timeline
  events: TimelineEvent[];

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Drill-down context (cursor position to restore)
  parentState: CostBasisAssetState;

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

  // Event counts for detail panel
  lotCount: number;
  transferCount: number;

  // Event data for drill-down (merged into timeline on drill-down)
  lots: AcquisitionViewItem[];
  disposals: DisposalViewItem[];
  transfers: TransferViewItem[];
}

// ─── Timeline Events ────────────────────────────────────────────────────────

type TimelineEvent = AcquisitionEvent | DisposalEvent | TransferEvent;

interface AcquisitionEvent {
  type: 'acquisition';
  date: string;
  sortTimestamp: string;
  quantity: string;
  asset: string;
  costBasisPerUnit: string;
  totalCostBasis: string;
  transactionId: number;
  lotId: string;
  remainingQuantity: string;
  status: 'open' | 'partially_disposed' | 'fully_disposed';
  fxConversion?:
    | {
        fxRate: string;
        fxSource: string;
      }
    | undefined;
  fxUnavailable?: true | undefined;
  originalCurrency?: string | undefined;
}

interface DisposalEvent {
  type: 'disposal';
  id: string;
  date: string;
  sortTimestamp: string;
  quantity: string;
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

interface TransferEvent {
  type: 'transfer';
  date: string;
  sortTimestamp: string;
  quantity: string;
  asset: string;
  costBasisPerUnit: string;
  totalCostBasis: string;
  sourceTransactionId: number;
  targetTransactionId: number;
  sourceLotId: string;
  sourceAcquisitionDate: string;
  feeUsdValue?: string | undefined;
  fxConversion?:
    | {
        fxRate: string;
        fxSource: string;
      }
    | undefined;
  fxUnavailable?: true | undefined;
  originalCurrency?: string | undefined;
}

// ─── View Items (raw data before timeline merge) ────────────────────────────

/** Acquisition lot as a view item */
type AcquisitionViewItem = AcquisitionEvent;

/** Disposal as a view item */
type DisposalViewItem = DisposalEvent;

/** Transfer as a view item */
type TransferViewItem = TransferEvent;
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
  | { type: 'DRILL_DOWN' } // Enter on asset → timeline
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
│   ├── ErrorBar (per-asset calculation errors, when present)
│   ├── AssetList
│   │   └── AssetRow
│   ├── Divider
│   ├── AssetDetailPanel (per-asset breakdown for selected)
│   ├── ErrorLine
│   └── ControlsBar
│
└── TimelineView (drill-down level)
    ├── TimelineHeader (asset, event counts, total gain/loss)
    ├── TimelineList
    │   ├── AcquisitionRow
    │   ├── DisposalRow
    │   └── TransferRow
    ├── Divider
    ├── TimelineDetailPanel (adapts to selected event type)
    │   ├── AcquisitionDetail
    │   ├── DisposalDetail
    │   └── TransferDetail
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
  --asset <symbol>               Filter to specific asset (lands on asset history timeline)
  --json                         Output JSON, bypass TUI
  -h, --help                     Display help
```

Notes:

- Interactive prompts still trigger when no method/jurisdiction/tax-year flags are provided (same behavior as today)
- `--asset` filters the result and skips straight to the asset history timeline for that asset

---

## Implementation Notes

### Data Flow

1. Parse and validate CLI options at the boundary
2. If interactive (no flags): run prompt flow (jurisdiction, method, year, currency, dates)
3. Initialize database
4. Show spinner: "Calculating cost basis..."
5. Call `CostBasisHandler.execute(params)` — returns in-memory lots, disposals, and lot transfers
6. Group lots, disposals, and transfers by asset (via lot's `assetSymbol`)
7. Compute per-asset summary: total proceeds, cost basis, gain/loss, taxable, holding period stats
8. For non-USD currency: use `CostBasisReportGenerator` to convert disposals (hard-fail) and lots/transfers (warn + USD fallback), with shared date-keyed FX cache
9. Build timeline events per asset: merge lots + disposals + transfers, sort by `sortTimestamp` with event-type tiebreak
10. Render Ink TUI with computed view data
11. On quit: close database

### Lot Transfers in CostBasisResult

`CostBasisResult` must expose `lotTransfers` directly (currently only available via `summary.lotTransfers`). Add:

```typescript
interface CostBasisResult {
  // ... existing fields
  lotTransfers: LotTransfer[];
}
```

### Transfer Date Derivation

`LotTransfer` includes `transferDate: Date`. It must be stamped from the source transaction datetime when transfer records are created. `createdAt` is calculation time and is not suitable for timeline ordering.

### Per-Asset Aggregation (Updated)

Group all three data types by the lot's `assetSymbol`. For each asset:

**From lots:**

- Filter lots by `assetSymbol`
- Build `AcquisitionViewItem` per lot (date, quantity, cost basis, remaining, status)

**From disposals:**

- Join each disposal to its lot via `lotId` to get `assetSymbol`
- Sum `totalProceeds`, `totalCostBasis`, `gainLoss` across all disposals
- Compute taxable based on jurisdiction rules
- For US: split into short-term (≤365 days) vs long-term (>365 days)
- Compute holding period stats: average, min, max of `holdingPeriodDays`

**From lot transfers:**

- Join each transfer to its source lot via `sourceLotId` to get `assetSymbol`
- Build `TransferViewItem` per transfer (date, quantity, cost basis, tx IDs, fee)

### Timeline Construction

When drilling down into an asset, merge all three event arrays into a single `TimelineEvent[]`:

1. Convert lots → `AcquisitionEvent[]`
2. Convert disposals → `DisposalEvent[]`
3. Convert transfers → `TransferEvent[]`
4. Merge and sort by `sortTimestamp` ascending
5. Tiebreak same-timestamp events: acquisitions first, transfers second, disposals last

### FX Conversion

When `currency !== 'USD'`, conversion rules are:

- Disposals: convert at disposal date; conversion failure is hard-fail.
- Acquisitions: convert at acquisition date; conversion failure logs warning and falls back to USD with `fxUnavailable`.
- Transfers: convert at transfer date; conversion failure logs warning and falls back to USD with `fxUnavailable`.

All conversions use the shared date-keyed FX cache in `CostBasisReportGenerator`.

### Quantity Formatting

Implement a `formatCryptoQuantity(value: string): string` utility:

1. Parse the decimal value
2. If the absolute value is less than `0.000000005` (rounds to zero at 8dp): return `<0.00000001`
3. Otherwise: format to 8 decimal places max, trim trailing zeros, minimum 2 decimal places

### Terminal Size

- Asset list: fills available height minus fixed chrome (header ~4, warning ~1, divider 1, detail ~10, controls ~2, scroll indicators ~2 = ~20 lines)
- Timeline: same layout, detail panel ~8-10 lines depending on event type
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — gain/loss always shown with `+`/`-` sign prefix, event types shown as text labels (`acquired`/`disposed`/`transfer`) not just markers
- Tax treatment always shown as text (`long-term`/`short-term`), not just color
- Amounts always include currency prefix for clarity
- Lot status shown as text (`open`/`partially disposed`/`fully disposed`), not just color
