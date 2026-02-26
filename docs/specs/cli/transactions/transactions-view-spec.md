# Transactions View — Interactive TUI Spec

## Overview

`exitbook transactions view` is a TUI for browsing, filtering, inspecting, and exporting processed transactions.

Two-phase interaction: browse mode (scrollable list + transaction detail panel) and inline export flow (triggered by `e`). Filters narrow the dataset via CLI flags.

`--json` bypasses the TUI.

The non-interactive counterpart `exitbook transactions export` provides the same export functionality for scripting (flags only, no TUI). Export lives under the `transactions` namespace.

---

## Two-Panel Layout

List (top) and detail panel (bottom), separated by a full-width dim `─` divider. Same shared behavior as prices-view and links-view.

### Scrolling

When the list exceeds the visible height:

- Visible window scrolls to keep the selected row in view
- `▲` / `▼` dim indicators appear when more items exist above/below
- No explicit scroll bar

### Navigation

| Key               | Action           | When                  |
| ----------------- | ---------------- | --------------------- |
| `↑` / `k`         | Move cursor up   | Browse, format select |
| `↓` / `j`         | Move cursor down | Browse, format select |
| `PgUp` / `Ctrl-U` | Page up          | Browse, format select |
| `PgDn` / `Ctrl-D` | Page down        | Browse, format select |
| `Home`            | Jump to first    | Browse, format select |
| `End`             | Jump to last     | Browse, format select |
| `e`               | Open export      | Browse only           |
| `q`               | Quit app         | Browse only           |
| `Esc`             | Cancel / quit    | Phase-dependent       |

Phase-specific behavior:

- Browse phase: `Esc` behaves like `q` (quit app)
- Format select phase: `Esc` cancels export and returns to browse phase
- Exporting phase: `Esc` is ignored
- Export complete/error phases: any key returns to browse phase

### Controls Bar

Bottom line, dim. Content adapts to export state.

### Loading State

```
⠋ Loading transactions...
```

Brief spinner, then TUI appears.

---

## Visual Example

```
Transactions  847 total · 312 trade · 289 transfer · 142 staking · 104 other

  #2456  kraken     2024-11-28 16:20  trade/buy       BTC       IN     0.5000     ✓
  #2455  kraken     2024-11-28 16:20  trade/buy       USD       OUT   48,250.00   ✓
  #2412  ethereum   2024-11-15 08:33  transfer/dep    ETH       IN     2.0000     ✓
▸ #2389  solana     2024-11-10 14:45  staking/reward  SOL       IN     1.2500     ⚠
  #2312  kraken     2024-10-28 09:12  trade/sell      BTC       OUT    0.2500     ✓
  #2198  kucoin     2024-10-15 11:08  transfer/dep    PENDLE    IN   150.0000     ✗
  #2041  solana     2024-10-01 09:30  transfer/wd     SOL       OUT    5.0000     ✓

────────────────────────────────────────────────────────────────────────────────
▸ #2389  solana  staking/reward  2024-11-10 14:45:22

  Inflows
    SOL      +1.2500    ⚠ no price

  No fees

  Blockchain: solana  block 245,891,023  confirmed
  Hash: 5Uh7...kQ3x
  To:   7nYp...r4Wz

↑↓/j/k · ^U/^D page · Home/End · e export · q/esc quit
```

---

## Header

```
Transactions  {total} total · {trade} trade · {transfer} transfer · {staking} staking · {other} other
```

- Title: white/bold
- Total count: white
- Category counts: white
- Category labels: dim
- Dot separators: dim
- Only show categories with count > 0

When filtered:

```
Transactions (kraken)  156 total · 98 trade · 58 transfer
```

```
Transactions (BTC)  312 total · 280 trade · 32 transfer
```

```
Transactions (missing prices)  20 total across 4 assets
```

### Category Grouping

Categories are aggregated from `operation.category`:

| Category   | Includes                                    |
| ---------- | ------------------------------------------- |
| `trade`    | buy, sell, swap                             |
| `transfer` | deposit, withdrawal, transfer               |
| `staking`  | stake, unstake, reward                      |
| `other`    | fee, batch, airdrop, vote, proposal, refund |

---

## List Columns

```
{cursor} #{txId}  {source}  {timestamp}  {operation}  {asset}  {dir}  {amount}  {price}
```

| Column    | Width | Alignment | Content                                |
| --------- | ----- | --------- | -------------------------------------- |
| Cursor    | 1     | —         | `▸` for selected, space otherwise      |
| TX ID     | 6     | right     | `#{id}` prefixed                       |
| Source    | 10    | left      | Exchange or blockchain name, truncated |
| Timestamp | 16    | left      | `YYYY-MM-DD HH:MM`                     |
| Operation | 15    | left      | `{category}/{type}`, truncated         |
| Asset     | 10    | left      | Primary asset symbol                   |
| Direction | 3     | left      | `IN` or `OUT` (primary movement)       |
| Amount    | 12    | right     | Locale-formatted                       |
| Price     | 1     | —         | Price status icon                      |

### Price Status Icons

| Condition             | Icon | Color  |
| --------------------- | ---- | ------ |
| All movements priced  | `✓`  | green  |
| Some movements priced | `⚠`  | yellow |
| No movements priced   | `✗`  | red    |
| No pricing needed     | `·`  | dim    |

"No pricing needed" applies to fiat-only movements (e.g., USD deposit) where price data is irrelevant.

### Row Colors

| Row State         | Color                     |
| ----------------- | ------------------------- |
| Selected (cursor) | white/bold for entire row |
| Normal            | standard color scheme     |
| Excluded (spam)   | dim for entire row        |

### Standard Row Color Scheme

| Element   | Color  |
| --------- | ------ |
| TX ID     | white  |
| Source    | cyan   |
| Timestamp | dim    |
| Operation | dim    |
| Asset     | white  |
| `IN`      | green  |
| `OUT`     | yellow |
| Amount    | green  |

### Primary Movement Selection

The list row shows the "primary" movement — the most significant asset movement in the transaction:

1. For trades: the non-fiat side (BTC in a BTC/USD trade)
2. For transfers: the single movement
3. For multi-asset: the first non-fiat inflow, else first non-fiat outflow, else first movement

This uses the existing `computePrimaryMovement()` utility.

---

## Detail Panel

The detail panel adapts to show all movements, fees, and metadata for the selected transaction.

### Trade Example

```
▸ #2456  kraken  trade/buy  2024-11-28 16:20:45

  Inflows
    BTC      +0.5000    $48,250.00 USD  ✓ kraken

  Outflows
    USD    -48,250.00

  Fees
    USD      -12.50  platform/balance

  Blockchain: —
```

### Transfer Example (Blockchain)

```
▸ #2412  ethereum  transfer/deposit  2024-11-15 08:33:12

  Inflows
    ETH      +2.0000    $7,841.20 USD  ✓ coingecko

  Fees
    ETH      -0.0021  network/balance    $8.24 USD  ✓ coingecko

  Blockchain: ethereum  block 19,234,567  confirmed
  Hash: 0x7a3f...8b2e
  From: 0x742d...bD38
  To:   0x1234...5678
```

### Staking Reward Example (Missing Price)

```
▸ #2389  solana  staking/reward  2024-11-10 14:45:22

  Inflows
    SOL      +1.2500    ⚠ no price

  No fees

  Blockchain: solana  block 245,891,023  confirmed
  Hash: 5Uh7...kQ3x
  To:   7nYp...r4Wz
```

### Multi-Movement Trade Example

```
▸ #2500  kraken  trade/swap  2024-12-01 10:00:00

  Inflows
    ETH      +5.0000    $19,500.00 USD  ✓ kraken

  Outflows
    BTC      -0.4000    $19,200.00 USD  ✓ kraken

  Fees
    ETH      -0.0050  platform/balance    $19.50 USD  ✓ kraken

  Blockchain: —
```

### Detail Panel Elements

| Element                | Color                 |
| ---------------------- | --------------------- |
| TX ID                  | white/bold            |
| Source                 | cyan                  |
| Operation type         | dim                   |
| Full timestamp         | dim                   |
| Section labels         | dim (`Inflows`, etc.) |
| Asset symbols          | white                 |
| `+` amounts (inflows)  | green                 |
| `-` amounts (outflows) | yellow                |
| Price value            | white                 |
| Price currency `USD`   | dim                   |
| Price source           | dim                   |
| `✓` (priced)           | green                 |
| `⚠ no price`           | yellow                |
| Fee amounts            | yellow                |
| Fee scope/settlement   | dim                   |
| `No fees`              | dim                   |
| `Blockchain:` label    | dim                   |
| Blockchain name        | cyan                  |
| Block height           | white                 |
| `confirmed`/`pending`  | green/yellow          |
| `—` (no blockchain)    | dim                   |
| Hash                   | dim (truncated)       |
| Address labels         | dim (`From:`, `To:`)  |
| Address values         | dim (truncated)       |

### Hash/Address Truncation

Hashes and addresses are truncated to `{first4}...{last4}` format to fit the terminal width. Full values shown if terminal width > 120.

### Movement Lines Format

```
  {asset}  {sign}{amount}    {price} USD  {priceIcon} {priceSource}
```

- `+` prefix for inflows, `-` prefix for outflows
- Price info only shown when present; `price` is pre-formatted with `$` prefix (e.g. `$48,250.00`)
- `USD` is always the price currency (hardcoded, dim)
- Asset column aligned across all movements in the panel

### Fee Lines Format

```
  {asset}  -{amount}  {scope}/{settlement}    {price} USD  {priceIcon} {priceSource}
```

### Section Visibility

- `Inflows` section: only shown when inflows exist
- `Outflows` section: only shown when outflows exist
- `Fees` section: show "No fees" when empty, otherwise list all fees
- `Blockchain:` line: always shown (shows `—` for exchange-only transactions)
- `Hash:` line: only for blockchain transactions
- `From:`/`To:` lines: only when addresses exist
- Notes: shown below addresses if present, prefixed with note type

---

## Sorting

Default: by timestamp descending (most recent first).

---

## Export Action (Inline)

Press `e` to export the current filtered dataset. The detail panel transforms into a brief export workflow — the list stays visible above. Output path is auto-generated; use `transactions export --output <path>` for custom paths.

### Phase 1: Format Selection

Press `e` — detail panel becomes a format selector:

```
────────────────────────────────────────────────────────────────────────────────
Export  847 transactions

  1  CSV — normalized   4 files: transactions, movements, fees, links
  2  CSV — simple       single file, multi-value cells
  3  JSON               structured JSON array

↑↓/j/k · 1/2/3 select format · esc cancel
```

When filters are active:

```
────────────────────────────────────────────────────────────────────────────────
Export  156 transactions (kraken)

  1  CSV — normalized   4 files: transactions, movements, fees, links
  2  CSV — simple       single file, multi-value cells
  3  JSON               structured JSON array

↑↓/j/k · 1/2/3 select format · esc cancel
```

| Element             | Color      |
| ------------------- | ---------- |
| `Export` label      | white/bold |
| Transaction count   | white      |
| Filter label        | dim        |
| Number keys `1/2/3` | white/bold |
| Format name         | white      |
| Format description  | dim        |

### Phase 2: Exporting

User presses `1`/`2`/`3` — export begins immediately with auto-generated path:

```
────────────────────────────────────────────────────────────────────────────────
Export  ⠋ Exporting 156 transactions...
```

### Phase 3: Complete

```
────────────────────────────────────────────────────────────────────────────────
Export  156 transactions exported ✓

  Format:  CSV normalized
  Files:   4
    data/kraken-transactions.csv
    data/kraken-transactions.movements.csv
    data/kraken-transactions.fees.csv
    data/kraken-transactions.links.csv

any key to continue
```

For simple CSV or JSON (single file):

```
────────────────────────────────────────────────────────────────────────────────
Export  847 transactions exported ✓

  Format:  JSON
  Output:  data/transactions.json

any key to continue
```

| Element              | Color      |
| -------------------- | ---------- |
| `Export` label       | white/bold |
| Transaction count    | green      |
| `exported`           | dim        |
| `✓`                  | green      |
| `Format:` label      | dim        |
| Format value         | white      |
| `Files:` / `Output:` | dim        |
| File count           | white      |
| File paths           | dim        |

### Phase 4: Error

If export fails (e.g., permission denied, disk full):

```
────────────────────────────────────────────────────────────────────────────────
Export  ✗ Failed to write data/kraken-transactions.csv: Permission denied

any key to continue
```

| Element        | Color      |
| -------------- | ---------- |
| `Export` label | white/bold |
| `✗`            | red        |
| Error message  | red        |

### Cancel

`Esc` during format selection cancels export and returns to normal transaction detail view. During exporting, input is ignored. On complete/error, any key returns to browse mode. No partial files are written — export is atomic (write to temp files, rename on success).

### Controls Bar (During Export)

| Phase         | Controls                                    |
| ------------- | ------------------------------------------- |
| Format select | `↑↓/j/k · 1/2/3 select format · esc cancel` |
| Exporting     | (empty)                                     |
| Complete      | `any key to continue`                       |
| Error         | `any key to continue`                       |

### Export Data Flow

1. User presses `e` — phase transitions to format selection
2. User presses `1`/`2`/`3` — auto-generate output path, begin export immediately
3. Re-query DB with the view's active filters (no limit) to get raw `UniversalTransactionData[]`
4. Fetch links when normalized CSV, convert to selected format, write atomically
5. On success: show complete phase with file paths
6. On failure: show error phase
7. Any key: return to normal detail view

### Re-query on Export

The `transactions view` may display a limited subset (e.g., `--limit 50` of 847 total). Export always exports the **full filtered dataset** — not just the displayed rows. The export re-queries the DB without `limit`. The export header shows the total count being exported, which may differ from the displayed count.

---

## Filters

### Source Filter (`--source`)

```bash
exitbook transactions view --source kraken     # Only Kraken transactions
exitbook transactions view --source solana      # Only Solana transactions
```

### Asset Filter (`--asset`)

```bash
exitbook transactions view --asset BTC         # Transactions involving BTC
exitbook transactions view --asset SOL         # Transactions involving SOL
```

Matches transactions where the asset appears in any inflow or outflow.

### Date Filters (`--since`, `--until`)

```bash
exitbook transactions view --since 2024-01-01                    # From Jan 2024
exitbook transactions view --since 2024-01-01 --until 2024-06-30 # H1 2024
```

### Operation Type Filter (`--operation-type`)

```bash
exitbook transactions view --operation-type buy     # Buy trades only
exitbook transactions view --operation-type reward   # Staking rewards only
```

### Missing Prices (`--no-price`)

```bash
exitbook transactions view --no-price     # Transactions with missing price data
```

### Limit (`--limit`)

```bash
exitbook transactions view --limit 100    # Show up to 100 transactions (default: 50)
```

When limit truncates results, header shows `showing {displayed} of {total}`.

---

## Empty States

### No Transactions

```
Transactions  0 total

  No transactions found.

  Import transactions first:
  exitbook import --exchange kucoin --csv-dir ./exports/kucoin

q quit
```

### No Transactions Matching Filter

```
Transactions (kraken)  0 total

  No transactions found for kraken.

q quit
```

### No Missing Prices

```
Transactions (missing prices)  0 total

  All transactions have price data.

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Returns structured transaction data.

```json
{
  "data": [
    {
      "id": 2456,
      "source_name": "kraken",
      "source_type": "exchange",
      "external_id": "tx-abc-123",
      "transaction_datetime": "2024-11-28T16:20:45Z",
      "operation_category": "trade",
      "operation_type": "buy",
      "movements_primary_asset": "BTC",
      "movements_primary_amount": "0.5000",
      "movements_primary_direction": "in",
      "from_address": null,
      "to_address": null,
      "blockchain_transaction_hash": null
    }
  ],
  "meta": {
    "total": 847,
    "displayed": 50,
    "limit": 50,
    "filters": {}
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as prices-view and links-view.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning                |
| ---- | ------ | ---------------------- |
| `✓`  | green  | All movements priced   |
| `⚠`  | yellow | Partial/missing prices |
| `✗`  | red    | No prices at all       |
| `·`  | dim    | No pricing needed      |
| `▸`  | —      | Cursor (bold)          |

**Content tier (what you read):**

| Element                 | Color  |
| ----------------------- | ------ |
| Asset symbols           | white  |
| Amounts (inflows)       | green  |
| Amounts (outflows)      | yellow |
| Source/blockchain names | cyan   |
| Direction `IN`          | green  |
| Direction `OUT`         | yellow |
| Fee amounts             | yellow |
| Block height            | white  |
| Price values            | white  |

**Content tier (export-specific):**

| Element                    | Color                                 |
| -------------------------- | ------------------------------------- |
| `Export` label             | white/bold                            |
| Export transaction count   | white (in-progress), green (complete) |
| `exported`                 | dim                                   |
| `✓` (export complete)      | green                                 |
| `✗` (export error)         | red                                   |
| Error message              | red                                   |
| Format number keys `1/2/3` | white/bold                            |
| Format names               | white                                 |

**Context tier (recedes):**

| Element                                  | Color |
| ---------------------------------------- | ----- |
| Timestamps                               | dim   |
| Divider `─`                              | dim   |
| Dot separator `·`                        | dim   |
| Operation type                           | dim   |
| Labels (`Inflows`, `Fees`, `From:`, etc) | dim   |
| Price currency `USD`                     | dim   |
| Price source                             | dim   |
| Fee scope/settlement                     | dim   |
| Hash and address values                  | dim   |
| `No fees`, `—`                           | dim   |
| Controls bar                             | dim   |
| Scroll indicators                        | dim   |
| `showing X of Y`                         | dim   |
| Format descriptions                      | dim   |
| `Format:` / `Files:` / `Output:` labels  | dim   |
| Filter label in export panel             | dim   |

---

## State Model

```typescript
type TransactionsViewPhase = 'browse' | 'export-format' | 'exporting' | 'export-complete' | 'export-error';

/** Reuses existing ExportFormat/CsvFormat from export-utils.ts */

interface TransactionsViewBase {
  // Data
  transactions: TransactionViewItem[];
  categoryCounts: CategoryCounts;
  totalCount: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters (applied from CLI args, read-only in TUI)
  filters: TransactionsViewFilters;

  // When limit truncates results
  displayedCount: number | undefined;
}

type TransactionsViewState =
  | (TransactionsViewBase & {
      phase: 'browse';
      exportPanel: undefined;
    })
  | (TransactionsViewBase & {
      phase: 'export-format';
      exportPanel: Record<string, never>;
    })
  | (TransactionsViewBase & {
      phase: 'exporting';
      exportPanel: {
        format: ExportFormat;
        csvFormat: CsvFormat | undefined;
      };
    })
  | (TransactionsViewBase & {
      phase: 'export-complete';
      exportPanel: {
        format: ExportFormat;
        csvFormat: CsvFormat | undefined;
        outputPaths: string[];
        transactionCount: number;
      };
    })
  | (TransactionsViewBase & {
      phase: 'export-error';
      exportPanel: {
        message: string;
      };
    });

/** Matches existing TransactionViewItem in transactions-view-state.ts */
interface TransactionViewItem {
  // Identity
  id: number;
  source: string;
  sourceType: 'exchange' | 'blockchain';
  externalId: string | undefined;
  datetime: string;

  // Operation
  operationCategory: string;
  operationType: string;

  // Primary movement (for list row)
  primaryAsset: string | undefined;
  primaryAmount: string | undefined;
  primaryDirection: 'in' | 'out' | undefined;

  // All movements (for detail panel)
  inflows: MovementDisplayItem[];
  outflows: MovementDisplayItem[];
  fees: FeeDisplayItem[];

  // Price status
  priceStatus: 'all' | 'partial' | 'none' | 'not-needed';

  // Blockchain metadata
  blockchain:
    | {
        name: string;
        blockHeight: number | undefined;
        transactionHash: string;
        isConfirmed: boolean;
      }
    | undefined;

  // Addresses
  from: string | undefined;
  to: string | undefined;

  // Notes
  notes: { type: string; message: string; severity: string | undefined }[];

  // Flags
  excludedFromAccounting: boolean;
  isSpam: boolean;
}

interface MovementDisplayItem {
  assetSymbol: string;
  amount: string;
  priceAtTxTime:
    | {
        price: string; // pre-formatted, e.g. "$48,250.00"
        source: string;
      }
    | undefined;
}

interface FeeDisplayItem {
  assetSymbol: string;
  amount: string;
  scope: string;
  settlement: string;
  priceAtTxTime:
    | {
        price: string; // pre-formatted, e.g. "$12.50"
        source: string;
      }
    | undefined;
}
```

Price currency is always USD. The `price` field is pre-formatted with `$` prefix. The detail panel renders `USD` as a static dim suffix.

### Actions

```typescript
type TransactionsViewAction =
  // Navigation
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Export
  | { type: 'OPEN_EXPORT' }
  | { type: 'SELECT_FORMAT'; format: ExportFormat; csvFormat: CsvFormat | undefined }
  | { type: 'EXPORT_COMPLETE'; outputPaths: string[]; transactionCount: number }
  | { type: 'EXPORT_FAILED'; message: string }
  | { type: 'CANCEL_EXPORT' }
  | { type: 'DISMISS_EXPORT_RESULT' };
```

---

## Component Structure

```
TransactionsViewApp
├── Header (total + category counts + filter labels)
├── TransactionList
│   └── TransactionRow
├── Divider
├── TransactionDetailPanel (when not exporting)
│   ├── InflowsSection
│   ├── OutflowsSection
│   ├── FeesSection
│   └── BlockchainSection
├── ExportPanel (when exporting — replaces detail panel)
│   ├── FormatSelector (phase: export-format)
│   ├── ExportingSpinner (phase: exporting)
│   ├── ExportComplete (phase: export-complete)
│   └── ExportError (phase: export-error)
└── ControlsBar (adapts to export phase)
```

---

## Command Options

Command tree:

```text
exitbook transactions view
exitbook transactions export
```

The `transactions` namespace is canonical for both browsing and export. There is no separate top-level export command in the target UX.

### `exitbook transactions view`

```
exitbook transactions view [options]

Options:
  --source <name>           Filter by exchange or blockchain name
  --asset <currency>        Filter by specific asset (e.g., BTC, ETH)
  --since <date>            Filter from date (ISO 8601, e.g., 2024-01-01)
  --until <date>            Filter until date (ISO 8601, e.g., 2024-12-31)
  --operation-type <type>   Filter by operation type (buy, sell, reward, etc.)
  --no-price                Show only transactions missing price data
  --limit <number>          Maximum transactions to display (default: 50)
  --json                    Output JSON, bypass TUI
  -h, --help                Display help
```

### `exitbook transactions export`

Non-interactive CLI for scripting. Accepts the same transaction filters plus export-specific options.

```
exitbook transactions export [options]

Options:
  --format <type>           Export format: csv, json (default: csv)
  --csv-format <type>       CSV format: normalized, simple (default: normalized)
  --output <path>           Output file path (default: data/transactions.csv)
  --json                    Output result metadata as JSON (file is still written)
  -h, --help                Display help
```

Exports all transactions. No filter flags — use `transactions view` for filtered browsing, then export inline via `e`.

#### Examples

```bash
# Export all transactions as normalized CSV (4 files)
exitbook transactions export

# Export as simple CSV (single file)
exitbook transactions export --format csv --csv-format simple --output ./reports/transactions.csv

# Export as JSON
exitbook transactions export --format json --output ./reports/transactions.json

# Export with JSON metadata output (for scripting)
exitbook transactions export --json
```

#### Output

Text mode (default):

```
Exported 847 transactions to:
  data/transactions.csv
  data/transactions.movements.csv
  data/transactions.fees.csv
  data/transactions.links.csv
```

JSON mode (`--json`):

```json
{
  "data": {
    "transactionCount": 847,
    "format": "csv",
    "csvFormat": "normalized",
    "outputPaths": [
      "data/transactions.csv",
      "data/transactions.movements.csv",
      "data/transactions.fees.csv",
      "data/transactions.links.csv"
    ]
  }
}
```

---

## Implementation Notes

### Data Flow (View)

1. Parse and validate CLI options at the boundary
2. Initialize database, fetch transactions via `TransactionRepository.getTransactions(filters)`
3. Apply client-side filters (`applyTransactionFilters`) for asset, until, operation-type, no-price
4. Transform `UniversalTransactionData[]` into `TransactionViewItem[]`
5. Compute category counts and price status per transaction
6. Apply limit
7. Render Ink TUI with dataset in memory
8. Database kept open (needed for export action)

### Data Flow (Inline Export)

1. User presses `e` — `OPEN_EXPORT` action, phase = `export-format`
2. User presses `1`/`2`/`3` — `SELECT_FORMAT` action, auto-generate path, phase = `exporting`
3. Re-query DB with the view's filters (no limit) to get full `UniversalTransactionData[]`
4. Fetch links when normalized CSV, convert output, write files atomically (temp → rename)
5. `EXPORT_COMPLETE` or `EXPORT_FAILED` action
6. Any key → `DISMISS_EXPORT_RESULT` action, return to normal view

Re-query is needed because the view holds `TransactionViewItem[]` (display format) while export needs raw `UniversalTransactionData[]` for CSV/JSON conversion.

### Data Flow (`transactions export` CLI)

1. Parse and validate CLI options at the boundary
2. Initialize database
3. Fetch all transactions (no filters)
4. Fetch links when normalized CSV, convert output, write files atomically
5. Output result summary, close database, exit

### Shared Export Logic

Both paths share the pure conversion functions (`convertToCSV`, `convertToNormalizedCSV`, `convertToJSON`) and atomic file writing. Query responsibility differs: inline export re-queries with the view's filters; CLI export fetches everything.

The existing `features/export/` command is deprecated and will be removed in favor of `transactions export`.

### Error Handling and Logging

Export failures must never be silent. On failure:

- Surface the error in the export panel/CLI output with concrete context (phase, path, format)
- Emit structured logs with enough context to debug file-write issues
- Return to browse mode only after explicit user acknowledgement

### Smart Path Generation

```typescript
function generateDefaultPath(filters: TransactionsViewFilters, format: ExportFormat): string {
  const parts: string[] = [];
  if (filters.sourceFilter) parts.push(filters.sourceFilter);
  if (filters.assetFilter) parts.push(filters.assetFilter.toLowerCase());
  parts.push('transactions');
  const extension = format === 'json' ? '.json' : '.csv';
  return `data/${parts.join('-')}${extension}`;
}
```

### Price Status Computation

For each transaction, inspect all movements (inflows + outflows):

- `all`: every non-fiat movement has `priceAtTxTime`
- `partial`: some movements have `priceAtTxTime`, some don't
- `none`: no movements have `priceAtTxTime`
- `not-needed`: all movements are fiat (USD, EUR, etc.) — no crypto pricing needed

### Fiat Detection

Assets considered fiat for price-status purposes: movements where `assetSymbol` matches a known fiat currency list (USD, EUR, GBP, etc.) or where `assetId` starts with `fiat:`.

### Terminal Size

- List panel: fills available height minus fixed chrome (header ~3, divider 1, detail panel ~10, controls ~2, scroll indicators ~2 = ~18 lines)
- Detail panel height varies by transaction complexity (more movements = taller)
- Export panel: ~8-12 lines depending on phase (format select tallest at ~8, normalized CSV complete tallest at ~10)
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — icons and text labels always accompany colors
- Direction always shown as text (`IN`/`OUT`), not just color-coded
- Export format selection uses number keys — no ambiguity with navigation keys
