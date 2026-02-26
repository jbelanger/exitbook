# Portfolio — Interactive TUI Spec

## Overview

`exitbook portfolio` shows current holdings with live spot prices, allocation percentages, and unrealized P&L derived from the cost basis engine's open lots. It composes balance calculation, spot pricing, and cost basis into a unified portfolio view.

Two-level TUI: asset list (Level 1) with detail panel, and per-asset transaction history (Level 2) via `Enter`. `--json` bypasses the TUI.

---

## Design Decisions

### Pricing Contract

Spot prices are always fetched in **USD** first. All providers normalize to USD per the `PriceData.currency` contract in `packages/price-providers/src/core/types.ts`. Non-USD display currencies apply FX conversion as a separate step — no direct non-USD spot quotes.

### Canonical Keying

Calculation stays keyed by **assetId** (e.g., `blockchain:ethereum:native`) for correctness in lot matching, account math, and transaction linkage.

Display rows are then aggregated by **assetSymbol** to avoid duplicate rows when the same asset is held across multiple accounts/sources (for example, exchange + on-chain). Each rendered position keeps the underlying `sourceAssetIds` list so history drill-down includes all merged assetIds.

### `--as-of` Semantics

Freezes the evaluation point. Spot prices are fetched at this timestamp. Cost basis calculation uses it as `endDate`. Prevents drift during long runs. Default: `new Date()` captured once at command start.

### Cost Basis Integration

Portfolio reuses `CostBasisHandler.execute()` with a synthetic config:

- `method`: from `--method` (default: `fifo`)
- `jurisdiction`: from `--jurisdiction` (default: `US`)
- `taxYear`: derived from `asOf` year (e.g., `asOf` in 2026 → `taxYear: 2026`)
- `currency`: always `USD` (display currency conversion is a separate step)
- `startDate`: epoch (`new Date(0)`) — include all historical acquisitions to build the full lot pool
- `endDate`: `asOf` timestamp

This gives us the complete set of open lots at the `asOf` point. The `taxYear` is needed by the handler contract but only affects disposal reporting (which we ignore — we only extract open lots).

Jurisdiction **does** affect the lot pool: CA and US rules differ on transfer-fee treatment (add-to-basis vs disposal), which changes lot cost basis and remaining quantities. This is correct behavior — the portfolio reflects the jurisdiction's accounting rules.

### Method/Jurisdiction Validation

Same validation as cost-basis command:

- `average-cost` only valid with `CA` jurisdiction
- `specific-id` not yet implemented
- `UK` and `EU` jurisdictions not yet implemented
- Invalid combinations produce a CLI error at the boundary

### Partial Price Failures

Spot price fetch uses `Promise.allSettled` — individual asset failures don't block others. Failed assets show `price unavailable` dim in their row, are excluded from portfolio totals (value, cost, and unrealized), and sort last. A top-level warning bar shows the count of unpriced assets.

**Totals contract**:

- `totalValue`: sum of all **priced, non-negative** assets (even if they have no open lots)
- `totalCost`: sum of assets that are **priced and have open lots**
- `totalUnrealizedGainLoss`: sum of assets that are **priced and have open lots**
- `totalUnrealizedPct`: `totalUnrealizedGainLoss / totalCost` when `totalCost > 0`, otherwise `undefined`
- `totalNetFiatIn`: net external fiat funding (`fiat inflows - fiat outflows - fiat fees`) from transfer transactions (fiat identified by currency symbol, not only `fiat:*` assetIds), converted to display currency when FX is available

This intentionally allows `totalValue` to include assets with unknown basis while keeping P&L math strictly based on known open lots.

### Unrealized P&L from Open Lots

Unrealized gain/loss is computed from the cost basis engine's open lots (lots with `remainingQuantity > 0`). For each asset: `sum((spotPrice - lot.costBasisPerUnit) * lot.remainingQuantity)`. This respects the selected cost basis method — FIFO and LIFO produce different open lot pools.

### No Open Lots Edge Case

When an asset has a positive balance but no open lots (e.g., received from an external source without acquisition history), cost basis and unrealized P&L show as unavailable. The asset still displays with its quantity and spot price, and contributes to `totalValue` but not `totalCost` or `totalUnrealizedGainLoss`.

### Prereq Loading UX

Prerequisites (`ensureLinks()`, `ensurePrices()`) may mount their own monitor TUI screens (linking progress, price enrichment progress) before the portfolio view renders. This is the same behavior as the cost-basis command — the prereq monitors display, complete, then the portfolio TUI replaces them. In JSON mode, prereqs run silently (no monitor screens).

---

## Shared Behavior

### Two-Panel Layout

List (top) and detail panel (bottom), separated by a full-width dim `────` divider. Same as all other TUI views.

### Scrolling

When the list exceeds the visible height:

- Visible window scrolls to keep the selected row in view
- `▲` / `▼` dim indicators appear when more items exist above/below
- No explicit scroll bar

### Navigation

| Key               | Action                                    | When              |
| ----------------- | ----------------------------------------- | ----------------- |
| `↑` / `k`         | Move cursor up                            | Always            |
| `↓` / `j`         | Move cursor down                          | Always            |
| `PgUp` / `Ctrl-U` | Page up                                   | Always            |
| `PgDn` / `Ctrl-D` | Page down                                 | Always            |
| `Home`            | Jump to first                             | Always            |
| `End`             | Jump to last                              | Always            |
| `Enter`           | Drill into asset transactions             | Level 1 (assets)  |
| `Backspace`       | Return to asset list                      | Level 2 (history) |
| `s`               | Cycle sort mode                           | Level 1 (assets)  |
| `r`               | Cycle P&L mode (unrealized/realized/both) | Level 1 (assets)  |
| `q` / `Esc`       | Back (Level 2) or Quit (Level 1)          | Always            |

### Controls Bar

Bottom line, dim. Changes per level:

**Level 1 (assets):**

```
↑↓/j/k · ^U/^D page · Home/End · s sort · r pnl · enter history · q/esc quit
```

**Level 2 (history):**

```
↑↓/j/k · ^U/^D page · Home/End · q/esc/backspace back
```

### Loading State

```
⠋ Calculating portfolio...
```

Brief spinner while data is assembled (after any prereq monitors complete), then TUI appears.

### Error State

Transient error line appears below the detail panel, cleared on next navigation.

### Quantity Formatting

All crypto quantities use `formatCryptoQuantity()` — maximum 8 decimal places with trailing zeros trimmed (minimum 2 decimal places). Amounts that round to zero at 8dp display as `<0.00000001`.

---

## Visual Example

```
Portfolio  8 assets · USD 127,450.23                              sorted by: value ▼
  Total Cost USD 95,045.00 · Unrealized +USD 32,405.23 (+34.1%)

     BTC      0.45         USD 63,225.00   49.6%   cost USD 37,620.00   unrealized +USD 25,605.00
     ETH     12.50         USD 42,500.00   33.3%   cost USD 40,100.00   unrealized +USD  2,400.00
▸    SOL     85.00         USD 12,750.00   10.0%   cost USD 10,200.00   unrealized +USD  2,550.00
     USDC  5,200.00        USD  5,200.00    4.1%   cost USD  5,200.00   unrealized  USD      0.00
     DOT    120.00         USD  1,200.00    0.9%   cost USD    800.00   unrealized +USD    400.00
     PENDLE  45.00         USD    625.23    0.5%   cost USD  1,125.00   unrealized -USD    499.77

────────────────────────────────────────────────────────────────────────────────
▸ SOL  85.00 SOL · USD 12,750.00 · 10.0% of portfolio

  Current Price: USD 150.00/unit
  Avg Cost:      USD 120.00/unit
  Unrealized:   +USD 2,550.00 (+25.0%)

  Open Lots: 3 (FIFO)
    0.45 SOL  acquired 2023-06-10  basis USD 95.00/unit   held 612d
    0.25 SOL  acquired 2024-01-15  basis USD 110.00/unit  held 393d
    0.30 SOL  acquired 2024-07-01  basis USD 155.00/unit  held 227d

  Accounts: kraken (50.00), solana blockchain (35.00)

  Press enter to view history

↑↓/j/k · ^U/^D page · Home/End · s sort · enter history · q/esc quit
```

---

## Header

```
Portfolio  {assetCount} assets · {currency} {totalValue}
  Net Fiat In {sign}{currency} {totalNetFiatIn}
  Total Cost {currency} {totalCost} · Unrealized {sign}{currency} {unrealizedGainLoss} ({unrealizedPct}%)
```

When all prices are unavailable:

```
Portfolio  8 assets · prices unavailable
```

When some prices are unavailable: `totalValue` reflects priced assets, while `totalCost` and `totalUnrealizedGainLoss` reflect priced assets with open lots.

When `totalCost` is unavailable or zero:

```
Portfolio  {assetCount} assets · {currency} {totalValue}
  Total Cost unavailable · Unrealized unavailable
```

- Title: white/bold
- Asset count: white
- `assets` label: dim
- Dot separator `·`: dim
- Currency: dim
- Total value: white
- `Total Cost` label: dim
- Total cost value: white
- `Unrealized` label: dim
- Unrealized gain/loss: green (positive), red (negative)
- Unrealized percentage: dim

---

## Warning Bar

When assets could not be priced, a warning line appears between the header and the list:

```
  ⚠ {n} assets could not be priced — values may be incomplete
```

- `⚠`: yellow
- Warning text: yellow

---

## Asset List Columns

```
{cursor}  {asset}  {quantity}  {currency} {currentValue}  {allocationPct}%  cost {currency} {totalCost}  unrealized {sign}{currency} {unrealizedGainLoss}
```

| Column     | Width    | Alignment | Content                                |
| ---------- | -------- | --------- | -------------------------------------- |
| Cursor     | 1        | —         | `▸` for selected, space otherwise      |
| Asset      | 10       | left      | Asset symbol                           |
| Quantity   | 14       | right     | Formatted crypto quantity              |
| Value      | variable | right     | `{currency} {amount}`                  |
| Allocation | 6        | right     | `{pct}%`                               |
| Cost       | variable | right     | `cost {currency} {amount}`             |
| Unrealized | variable | right     | `unrealized {sign}{currency} {amount}` |

### Asset Row Colors

| Element            | Color |
| ------------------ | ----- |
| Asset symbol       | white |
| Quantity           | white |
| Currency           | dim   |
| Current value      | white |
| Allocation %       | dim   |
| `cost` label       | dim   |
| Cost basis value   | white |
| `unrealized` label | dim   |
| Gain (positive)    | green |
| Loss (negative)    | red   |
| Zero unrealized    | dim   |

### Price Unavailable Row

```
     OBSCURE  100.00       price unavailable
```

Row is dim. No value, allocation, cost, or unrealized columns.

### Negative Balance Row

Quantity shown in red. Asset excluded from portfolio totals.

```
     DOT     -2.50         USD -375.00
```

Detail panel shows: `⚠ Negative balance — likely missing inflow transactions`

---

## Detail Panel

Shows expanded information for the selected asset.

### Standard Detail

```
▸ {asset}  {quantity} {asset} · {currency} {currentValue} · {allocationPct}% of portfolio

  Current Price: {currency} {spotPrice}/unit
  Avg Cost:      {currency} {avgCost}/unit
  Unrealized:   {sign}{currency} {unrealizedGainLoss} ({unrealizedPct}%)

  Open Lots: {lotCount} ({method})
    {qty} {asset}  acquired {date}  basis {currency} {costPerUnit}/unit  held {days}d
    {qty} {asset}  acquired {date}  basis {currency} {costPerUnit}/unit  held {days}d

  Accounts: {sourceName} ({qty}), {sourceName} ({qty})
```

### No Open Lots Detail

When an asset has a balance but no open lots:

```
▸ BTC  0.15 BTC · USD 14,100.00 · 11.1% of portfolio

  Current Price: USD 94,000.00/unit
  Cost basis unavailable

  Accounts: bitcoin blockchain (0.15)
```

### Price Unavailable Detail

```
▸ OBSCURE  100.00 OBSCURE

  Current price could not be fetched.
  Run exitbook prices enrich or check provider configuration.

  Accounts: kraken (100.00)
```

### Negative Balance Detail

```
▸ DOT  -2.50 DOT

  ⚠ Negative balance — likely missing inflow transactions

  Accounts: polkadot blockchain (-2.50)
```

### Detail Panel Colors

| Element                       | Color      |
| ----------------------------- | ---------- |
| Asset symbol                  | white/bold |
| Quantity                      | white      |
| `of portfolio`                | dim        |
| Currency                      | dim        |
| Current value                 | white      |
| Allocation %                  | white      |
| Labels (`Current Price:`)     | dim        |
| Spot price                    | white      |
| `/unit`                       | dim        |
| `Avg Cost:` label             | dim        |
| Avg cost value                | white      |
| `Unrealized:` label           | dim        |
| Unrealized gain               | green      |
| Unrealized loss               | red        |
| Unrealized percentage         | dim        |
| `Open Lots:` label            | dim        |
| Lot count                     | white      |
| Method in parens              | dim        |
| Lot quantity                  | white      |
| `acquired` label              | dim        |
| Acquisition date              | dim        |
| `basis` label                 | dim        |
| Cost basis per unit           | white      |
| `held` label                  | dim        |
| Holding days                  | white      |
| `d` suffix                    | dim        |
| `Accounts:` label             | dim        |
| Source names                  | cyan       |
| Account quantities            | white      |
| Warning text (`⚠`)            | yellow     |
| `Cost basis unavailable`      | dim        |
| Explanatory text              | dim        |
| `Press enter to view history` | dim        |
| Sort indicator                | dim        |

---

## Transaction History (Level 2)

Press `Enter` on an asset in Level 1 to drill into its transaction history. Press `Backspace`, `Esc`, or `q` to return to Level 1 (cursor position is restored).

### Data Source

Transactions are filtered from the already-loaded transaction set by matching `assetId` — any transaction where the asset appears in inflows, outflows, or fees. Sorted by datetime descending (newest first).

### Visual Example

```
◂ SOL  85.00 SOL · 42 transactions

     2025-12-15  trade        +10.00 SOL   USD 1,500.00   kraken
     2025-11-02  transfer     -5.00 SOL                   → solana blockchain
▸    2025-09-18  trade        +25.00 SOL   USD 3,250.00   kraken
     2025-07-04  staking      +0.50 SOL    USD 72.50      solana blockchain
     2025-03-22  trade        +50.00 SOL   USD 5,500.00   kraken
     2024-01-15  transfer     +5.00 SOL                   ← kraken

────────────────────────────────────────────────────────────────────────────────
▸ 2025-09-18  trade  +25.00 SOL

  Operation:  trade (buy)
  Source:     kraken
  Inflows:    +25.00 SOL
  Outflows:   -3,250.00 USD
  Fees:       -2.50 USD

↑↓/j/k · ^U/^D page · Home/End · q/esc/backspace back
```

### Header (Level 2)

```
◂ {asset}  {quantity} {asset} · {transactionCount} transactions
```

- `◂`: dim, indicates back navigation is available
- Asset symbol: white/bold
- Quantity: white
- Transaction count: white
- `transactions` label: dim

### Transaction Row Columns

```
{cursor}  {date}  {category}  {sign}{amount} {asset}  {value}  {source}
```

| Column   | Width    | Alignment | Content                                        |
| -------- | -------- | --------- | ---------------------------------------------- |
| Cursor   | 1        | —         | `▸` for selected, space otherwise              |
| Date     | 10       | left      | `YYYY-MM-DD`                                   |
| Category | 12       | left      | `trade`, `transfer`, `staking`, etc.           |
| Amount   | 14       | right     | `+`/`-` prefixed quantity of the drilled asset |
| Value    | variable | right     | `{currency} {amount}` — fiat value at tx time  |
| Source   | variable | left      | Account source name                            |

For transfers, the value column shows the transfer direction arrow instead: `→ {destination}` or `← {origin}`.

### Transaction Row Colors

| Element              | Color |
| -------------------- | ----- |
| Date                 | dim   |
| Category             | white |
| Inflow amount (`+`)  | green |
| Outflow amount (`-`) | red   |
| Currency             | dim   |
| Fiat value           | white |
| Source name          | cyan  |
| Transfer arrows      | dim   |

### Transaction Detail Panel

Shows expanded info for the selected transaction. Same layout as the transactions browse TUI detail panel:

```
▸ {date}  {operationType}  {sign}{amount} {asset}

  Operation:  {category} ({operationType})
  Source:     {sourceName}
  Inflows:    {inflow lines}
  Outflows:   {outflow lines}
  Fees:       {fee lines}
```

When no fees: `Fees:` line omitted. When no inflows or outflows: respective line omitted.

### Transaction Detail Colors

| Element          | Color  |
| ---------------- | ------ |
| Date             | dim    |
| Operation type   | white  |
| Amount (inflow)  | green  |
| Amount (outflow) | red    |
| Labels           | dim    |
| Source name      | cyan   |
| Inflow values    | green  |
| Outflow values   | red    |
| Fee values       | yellow |

### Empty State (Level 2)

When an asset has no transactions (shouldn't normally occur — the asset wouldn't have a balance):

```
◂ OBSCURE  100.00 OBSCURE · 0 transactions

  No transactions found for this asset.

q/esc/backspace back
```

---

## Sorting

Press `s` to cycle through sort modes. The active mode is shown in the header: `sorted by: {mode} ▼`.

| Mode         | Key field            | Direction  |
| ------------ | -------------------- | ---------- |
| `value`      | Current value        | Descending |
| `gain`       | Unrealized gain/loss | Descending |
| `loss`       | Unrealized gain/loss | Ascending  |
| `allocation` | Allocation %         | Descending |

Default: `value`.

Cycle order: `value` → `gain` → `loss` → `allocation` → `value`.

### Tier Ordering (all modes)

| Priority | Condition        |
| -------- | ---------------- |
| 1        | Priced assets    |
| 2        | Unpriced assets  |
| 3        | Negative balance |

Unpriced and negative-balance assets always sort last regardless of mode. Within unpriced: absolute quantity descending. Within negative: absolute quantity descending.

### Sort Field Availability

Assets without open lots have `undefined` unrealized gain/loss. In `gain`/`loss` modes, these sort after assets with known values (but before unpriced/negative). In `allocation` mode, unpriced assets have `undefined` allocation and sort last (same as tier ordering).

---

## Empty States

### No Transactions

```
Portfolio  0 assets

  No transactions found.

  Import data to create accounts:
  exitbook import --exchange kucoin --csv-dir ./exports/kucoin

q quit
```

### Zero Holdings (All Fully Disposed/Transferred)

```
Portfolio  0 assets

  All asset balances are zero — no current holdings.

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Outputs portfolio data in JSON format.

```json
{
  "data": {
    "asOf": "2026-02-13T15:30:00.000Z",
    "method": "fifo",
    "jurisdiction": "US",
    "displayCurrency": "USD",
    "totalValue": "127450.23",
    "totalNetFiatIn": "104500.00",
    "totalCost": "95045.00",
    "totalUnrealizedGainLoss": "32405.23",
    "totalUnrealizedPct": "34.1",
    "positions": [
      {
        "assetId": "blockchain:bitcoin:native",
        "assetSymbol": "BTC",
        "quantity": "0.45000000",
        "spotPricePerUnit": "140500.00",
        "currentValue": "63225.00",
        "allocationPct": "49.6",
        "totalCostBasis": "37620.00",
        "avgCostPerUnit": "83600.00",
        "unrealizedGainLoss": "25605.00",
        "unrealizedPct": "68.1",
        "priceStatus": "ok",
        "openLots": [
          {
            "lotId": "uuid",
            "quantity": "0.25",
            "remainingQuantity": "0.20",
            "costBasisPerUnit": "42000.00",
            "acquisitionDate": "2023-02-09T00:00:00.000Z",
            "holdingDays": 1100
          }
        ],
        "accountBreakdown": [
          { "accountId": 1, "sourceName": "kraken", "accountType": "exchange-api", "quantity": "0.30" },
          { "accountId": 4, "sourceName": "bitcoin", "accountType": "blockchain", "quantity": "0.15" }
        ]
      },
      {
        "assetId": "exchange:kraken:OBSCURE",
        "assetSymbol": "OBSCURE",
        "quantity": "100.00",
        "priceStatus": "unavailable",
        "priceError": "No CoinGecko coin ID found for symbol: OBSCURE",
        "openLots": [],
        "accountBreakdown": [
          { "accountId": 1, "sourceName": "kraken", "accountType": "exchange-api", "quantity": "100.00" }
        ]
      }
    ]
  },
  "warnings": ["1 asset could not be priced — values may be incomplete"],
  "meta": {
    "totalAssets": 8,
    "pricedAssets": 7,
    "unpricedAssets": 1,
    "timestamp": "2026-02-13T15:30:05.000Z"
  }
}
```

All numeric values are strings via `Decimal.toFixed()`. Unavailable fields are omitted (undefined in TS) — no silent defaults.

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning         |
| ---- | ------ | --------------- |
| `⚠`  | yellow | Price warning   |
| `▸`  | —      | Cursor (bold)   |
| `◂`  | dim    | Back navigation |

**Content tier (what you read):**

| Element                 | Color  |
| ----------------------- | ------ |
| Asset symbols           | white  |
| Quantities              | white  |
| Current value           | white  |
| Cost basis amounts      | white  |
| Spot price              | white  |
| Avg cost                | white  |
| Lot counts              | white  |
| Holding period values   | white  |
| Lot quantities          | white  |
| Lot cost basis per unit | white  |
| Gain (positive)         | green  |
| Loss (negative)         | red    |
| Source names            | cyan   |
| Negative quantity       | red    |
| Price warning text      | yellow |
| Tx inflow amount (`+`)  | green  |
| Tx outflow amount (`-`) | red    |
| Tx fee values           | yellow |
| Tx operation type       | white  |
| Tx fiat value           | white  |

**Context tier (recedes):**

| Element                                          | Color |
| ------------------------------------------------ | ----- |
| `assets` label in header                         | dim   |
| Dot separator `·`                                | dim   |
| Currency symbols (`USD`, `CAD`)                  | dim   |
| `Total Cost` / `Unrealized` labels               | dim   |
| Unrealized percentage                            | dim   |
| Allocation percentages                           | dim   |
| `cost` / `unrealized` labels in rows             | dim   |
| `Current Price:` / `Avg Cost:` labels            | dim   |
| `/unit` suffix                                   | dim   |
| `Open Lots:` label                               | dim   |
| Method in parens                                 | dim   |
| `acquired` / `basis` / `held` labels             | dim   |
| `d` suffix on holding days                       | dim   |
| Acquisition dates in lot rows                    | dim   |
| `Accounts:` label                                | dim   |
| `of portfolio` text                              | dim   |
| `price unavailable` text                         | dim   |
| `Cost basis unavailable` text                    | dim   |
| Explanatory text                                 | dim   |
| Divider `────`                                   | dim   |
| Controls bar                                     | dim   |
| Scroll indicators `▲` / `▼`                      | dim   |
| Zero unrealized amount                           | dim   |
| Sort indicator (`sorted by: ...`)                | dim   |
| `Press enter to view history`                    | dim   |
| `transactions` label in history header           | dim   |
| `◂` back arrow                                   | dim   |
| Tx dates                                         | dim   |
| Transfer arrows (`→`, `←`)                       | dim   |
| Tx detail labels (`Operation:`, `Source:`, etc.) | dim   |

---

## State Model

```typescript
type SortMode = 'value' | 'gain' | 'loss' | 'allocation';

/** Level 1 — Asset list */
interface PortfolioAssetsState {
  view: 'assets';

  // Configuration
  method: string;
  jurisdiction: string;
  displayCurrency: string;
  asOf: string; // ISO 8601

  // Portfolio totals
  // totalValue: undefined when all assets are unpriced (or only negative balances remain)
  // totalNetFiatIn: undefined when no in-scope transactions exist up to as-of
  // totalCost/totalUnrealizedGainLoss: undefined when no priced assets have open lots
  // totalUnrealizedPct: undefined when totalCost is undefined or zero
  totalValue: string | undefined;
  totalNetFiatIn: string | undefined;
  totalCost: string | undefined;
  totalUnrealizedGainLoss: string | undefined;
  totalUnrealizedPct: string | undefined;

  // Positions
  positions: PortfolioPositionItem[];
  transactionsByAssetId: Map<string, PortfolioTransactionItem[]>;
  totalTransactions: number;

  // Sorting
  sortMode: SortMode;

  // Warnings
  warnings: string[];

  // Navigation
  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
}

/** Level 2 — Transaction history for a single asset */
interface PortfolioHistoryState {
  view: 'history';

  // Asset context
  assetId: string;
  assetSymbol: string;
  assetQuantity: string;
  displayCurrency: string;

  // Transaction list
  transactions: PortfolioTransactionItem[];
  totalTransactions: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Drill-down context (cursor position to restore)
  parentState: PortfolioAssetsState;

  error?: string | undefined;
}

type PortfolioState = PortfolioAssetsState | PortfolioHistoryState;

interface PortfolioPositionItem {
  assetId: string;
  assetSymbol: string;
  quantity: string;
  isNegative: boolean;

  // Pricing (undefined when unavailable)
  spotPricePerUnit?: string | undefined;
  currentValue?: string | undefined;
  allocationPct?: string | undefined;
  priceStatus: 'ok' | 'unavailable';
  priceError?: string | undefined;

  // Cost basis (undefined when no open lots)
  totalCostBasis?: string | undefined;
  avgCostPerUnit?: string | undefined;
  unrealizedGainLoss?: string | undefined;
  unrealizedPct?: string | undefined;

  // Open lots from cost basis engine
  openLots: OpenLotItem[];

  // Per-account breakdown
  accountBreakdown: AccountBreakdownItem[];
}

interface OpenLotItem {
  lotId: string;
  quantity: string;
  remainingQuantity: string;
  costBasisPerUnit: string;
  acquisitionDate: string;
  holdingDays: number;
}

interface AccountBreakdownItem {
  accountId: number;
  sourceName: string;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  quantity: string;
}

interface PortfolioTransactionItem {
  id: number;
  datetime: string;
  operationCategory: string;
  operationType: string;
  sourceName: string;

  // Movement of the drilled asset (signed quantity)
  assetAmount: string;
  assetDirection: 'in' | 'out';

  // Fiat value at transaction time (undefined if no price data)
  fiatValue?: string | undefined;

  // Transfer context (undefined for non-transfers)
  transferPeer?: string | undefined; // e.g., "solana blockchain" or "kraken"
  transferDirection?: 'to' | 'from' | undefined;

  // All movements (for detail panel)
  inflows: { assetSymbol: string; amount: string }[];
  outflows: { assetSymbol: string; amount: string }[];
  fees: { assetSymbol: string; amount: string }[];
}
```

### Actions

```typescript
type PortfolioAction =
  // Navigation (both levels)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Drill-down
  | { type: 'DRILL_DOWN' }
  | { type: 'DRILL_UP' }

  // Sorting (Level 1 only)
  | { type: 'CYCLE_SORT' }

  // Error handling
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR'; error: string };
```

---

## Component Structure

```
PortfolioApp (switches on state.view)
├── Level 1: Assets
│   ├── PortfolioHeader (asset count, total value, total cost, unrealized, sort indicator)
│   ├── WarningBar (unpriced assets, when present)
│   ├── PositionList
│   │   └── PositionRow (asset, quantity, value, allocation, cost, unrealized)
│   ├── Divider
│   ├── PositionDetailPanel (price, avg cost, unrealized, open lots, accounts)
│   ├── ErrorLine
│   └── ControlsBar ("s sort · enter history · q/esc quit")
│
├── Level 2: Transaction History
│   ├── HistoryHeader (back arrow, asset, quantity, transaction count)
│   ├── TransactionList
│   │   └── TransactionRow (date, category, amount, value, source)
│   ├── Divider
│   ├── TransactionDetailPanel (operation, source, inflows, outflows, fees)
│   ├── ErrorLine
│   └── ControlsBar ("q/esc/backspace back")
```

---

## Command Options

```
exitbook portfolio [options]

Options:
  --method <method>              Cost basis method: fifo, lifo, average-cost (default: fifo)
  --jurisdiction <code>          Tax jurisdiction: CA, US (default: US)
  --fiat-currency <currency>     Display currency: USD, CAD, EUR, GBP (default: USD)
  --as-of <datetime>             Point-in-time snapshot (ISO 8601, default: now)
  --json                         Output JSON, bypass TUI
  -h, --help                     Display help
```

Notes:

- `--as-of` freezes both spot price timestamp and cost basis `endDate`
- No interactive prompts — all options have defaults
- `--method` affects which lots are open (FIFO vs LIFO produce different remaining lots)
- `--jurisdiction` affects lot pool via jurisdiction-specific transfer-fee rules (CA: add-to-basis, US: disposal)
- `average-cost` only valid with `--jurisdiction CA`; invalid combinations produce a CLI error

---

## Implementation Notes

### Data Flow

1. Parse + validate CLI options at boundary (Zod schema, including method/jurisdiction compatibility)
2. Capture `asOf = options.asOf ?? new Date()` once — used everywhere
3. Init DB + price provider manager
4. Run `ensureLinks()` then `ensurePrices()` (reuse from `cost-basis-prereqs.ts`; in TUI mode these may mount their own monitor screens before portfolio renders)
5. Fetch all transactions → `calculateBalances()` → per-asset holdings keyed by assetId
6. Filter to non-zero holdings
7. Fetch spot prices in USD for each held asset via `PriceProviderManager.fetchPrice()` with `timestamp: asOf`
8. If `fiatCurrency !== 'USD'`: fetch FX rate at `asOf` via same provider manager, convert all USD amounts
9. Run cost basis calculation: `CostBasisHandler.execute()` with synthetic config (`startDate: new Date(0)`, `endDate: asOf`, `taxYear: asOf.getFullYear()`, `currency: 'USD'`) → extract open lots (lots with `remainingQuantity > 0`) grouped by assetId
10. `buildPortfolioPositions()` — merge holdings + spot prices + open lots → view items
11. Render TUI (or output JSON)
12. On quit: destroy price manager, close DB (always — success and error paths)

### Lifecycle/Cleanup

- `PriceProviderManager.destroy()` and `database.close()` called in `finally` block on all paths
- Use `ctx.onCleanup()` pattern from `CommandContext` (same as cost-basis)

### Account Breakdown

Per-account quantities are derived from transactions. Group all transactions by `accountId`, run `calculateBalances()` per account, then merge into `accountBreakdown` per assetId.

### Sorting

Sort is applied in the reducer on `CYCLE_SORT`. The reducer re-sorts `positions` in place using the tier ordering (priced → unpriced → negative) with the mode-specific comparator within each tier. `selectedIndex` resets to 0 and `scrollOffset` resets to 0 on sort change.

### Transaction History (Drill-Down)

Transaction items are pre-computed per asset into `transactionsByAssetId` (stored in `PortfolioAssetsState`) before the TUI renders. On `Enter`, the reducer dispatches `DRILL_DOWN` (no payload), looks up the selected asset's transactions from the map, captures the current `PortfolioAssetsState` as `parentState`, and transitions to `PortfolioHistoryState`. On `DRILL_UP`, the reducer restores `parentState` directly — no re-computation needed.

### Terminal Size

- Position list: fills available height minus fixed chrome (header ~4, warning ~1, divider 1, detail ~12, controls ~2, scroll indicators ~2 = ~22 lines)
- Transaction list (Level 2): same layout, header is shorter (~2 lines), detail panel is similar (~8 lines)
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — gain/loss always shown with `+`/`-` sign prefix
- Amounts always include currency prefix
- `price unavailable` shown as text, not just absence of data
- Transfer direction always shown with `→`/`←` arrows plus destination/origin name
