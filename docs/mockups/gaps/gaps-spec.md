# Gaps — Interactive TUI Spec

## Overview

`exitbook gaps` audits data quality across categories (fees, links, prices, validation) and displays results in an interactive Ink TUI. Replaces the old `exitbook gaps view` subcommand with a direct top-level command and a two-level browser: a **summary dashboard** showing all categories, and **detail views** for drilling into individual categories.

- **Default (no flags):** Summary view showing all categories with issue counts
- **`--category fees`:** Jump directly to fee detail view
- **`--category links`:** Jump directly to link detail view
- **`--json`:** Structured JSON output, bypasses TUI

Read-only. No mutations.

---

## Visual Examples

### Summary View (default)

```
Data Quality                                                    11 issues

  ✓  Links           3 uncovered inflows · 2 unmatched outflows
  ⚠  Fees            8 issues across 6 transactions
  ○  Prices          coming soon
  ○  Validation      coming soon

                                                  ↑↓ navigate  enter drill in  q quit
```

### Summary View — All Clean

```
Data Quality                                                     0 issues

  ✓  Links           all movements have confirmed counterparties
  ✓  Fees            all fees properly mapped
  ○  Prices          coming soon
  ○  Validation      coming soon

                                                  ↑↓ navigate  enter drill in  q quit
```

### Fee Detail View

```
Fee Gaps                                          8 issues · 6 affected transactions

  Type Summary
    Fees without price data              5
    Fee transactions with empty fields   2
    Fees in movements instead of fields  1

  ⚠  #1042  kraken     2024-03-15 14:23  fee_without_price      0.0012 ETH
  ⚠  #1087  kraken     2024-03-22 09:41  fee_without_price      0.0008 ETH
  ⚠  #1134  kucoin     2024-04-01 18:55  fee_without_price      0.00004 BTC
  ⚠  #1201  coinbase   2024-04-08 11:12  fee_without_price      2.5000 MATIC
▸ ⚠  #1289  kraken     2024-04-15 20:30  fee_without_price      0.0015 ETH
  ⚠  #1456  kucoin     2024-05-02 06:44  missing_fee_fields     —
  ⚠  #1523  kraken     2024-05-10 13:18  fee_in_movements       0.0003 ETH
  ⚠  #1678  coinbase   2024-05-20 22:05  missing_fee_fields     —

────────────────────────────────────────────────────────────────────────────────────────
▸ #1289  fee_without_price  kraken  2024-04-15 20:30:12
  Issue: Network fee exists but has no price data
  Amount: 0.0015 ETH
  Suggestion: Run `exitbook prices fetch` to populate missing prices

                                              ↑↓ navigate  esc/← summary  q quit
```

### Link Detail View

```
Link Gaps                                 5 issues · 3 uncovered inflows · 2 unmatched outflows

  Asset Breakdown
    ETH     2 inflows missing 3.5000 ETH · 1 outflow unmatched for 1.2000 ETH
    BTC     1 inflow missing 0.5000 BTC · 1 outflow unmatched for 0.2500 BTC

▸ ⚠  #2041  ethereum   2024-03-18 09:12  ETH   IN   1.5000 of 1.5000   0% covered
  ⚠  #2198  ethereum   2024-04-02 14:45  ETH   IN   2.0000 of 2.0000   0% covered
  ⚠  #2312  bitcoin    2024-04-15 08:33  BTC   IN   0.5000 of 0.5000   0% covered
  ⚠  #2456  kraken     2024-05-01 16:20  ETH   OUT  1.2000 of 1.2000   0% covered
  ⚠  #2589  kraken     2024-05-12 11:08  BTC   OUT  0.2500 of 0.2500   0% covered

────────────────────────────────────────────────────────────────────────────────────────
▸ #2041  ethereum  transfer/deposit  2024-03-18 09:12:34
  Missing: 1.5000 ETH of 1.5000 ETH inflow (0% confirmed coverage)
  Suggested matches: 2 (best 82.4% confidence)
  Action: Run `exitbook links run` then confirm matches to bridge this gap.

                                              ↑↓ navigate  esc/← summary  q quit
```

### Empty State — No Data

```
Data Quality                                                     0 issues

  No transactions found. Import data first:
    exitbook import --exchange kraken --csv-dir ./exports/kraken

                                                                     q quit
```

### Empty State — Category Has No Issues

```
Fee Gaps                                            0 issues · all fees properly mapped

  No fee gaps found. All transactions have properly mapped fees.

                                                         esc/← summary  q quit
```

### Loading State

```
⠋ Analyzing data quality...
```

### Error State

```
⚠ Failed to analyze data quality
  Database is locked

                                                                     q quit
```

---

## Summary View Layout

The summary view is the default landing screen, showing a health dashboard for all gap categories.

### Header

```
Data Quality                                                    {total} issues
```

- Title: white/bold
- Issue count: yellow when > 0, green when 0
- When 0 issues: show `0 issues` (not omitted)

### Category Rows

```
{cursor} {icon}  {name}           {one-liner}
```

| Column    | Width    | Content                                        |
| --------- | -------- | ---------------------------------------------- |
| Cursor    | 1        | `▸` for selected, space otherwise              |
| Icon      | 1        | Status icon (see below)                        |
| Name      | 12       | Category name, left-aligned                    |
| One-liner | variable | Compact summary of issues or clean/unavailable |

### Category Icons

| State       | Icon | Color  | Meaning                    |
| ----------- | ---- | ------ | -------------------------- |
| Has issues  | `⚠`  | yellow | Issues found               |
| Clean       | `✓`  | green  | No issues in this category |
| Unavailable | `○`  | dim    | Not yet implemented        |

### One-liner Format

**Fees (has issues):**

```
8 issues across 6 transactions
```

**Fees (clean):**

```
all fees properly mapped
```

**Links (has issues):**

```
3 uncovered inflows · 2 unmatched outflows
```

**Links (clean):**

```
all movements have confirmed counterparties
```

**Prices / Validation:**

```
coming soon
```

### Category Order

Fixed order: Links, Fees, Prices, Validation. Implemented categories first, unavailable last within each group.

### Navigation

- `↑`/`↓`/`j`/`k` navigate categories
- `Enter` drills into the selected category (only for implemented categories)
- `Enter` on an unavailable category does nothing
- `q`/`Esc` quits

---

## Fee Detail Layout

Shown when drilling into the Fees category from the summary, or when launched with `--category fees`.

### Header

```
Fee Gaps                                          {total} issues · {affected} affected transactions
```

- Title: white/bold
- Counts: yellow when > 0, green when 0

### Type Summary

A compact breakdown by fee gap type, shown above the issue list:

```
  Type Summary
    Fees without price data              {count}
    Fee transactions with empty fields   {count}
    Fees in movements instead of fields  {count}
    Outflows not mapped to fee fields    {count}
```

- Label `Type Summary`: white/bold
- Type labels: white
- Counts: green
- Only show types with count > 0

### Issue List

```
{cursor} {icon}  #{txId}  {source}  {timestamp}  {issueType}  {amount}
```

| Column     | Width    | Alignment | Content                                   |
| ---------- | -------- | --------- | ----------------------------------------- |
| Cursor     | 1        | —         | `▸` for selected, space otherwise         |
| Icon       | 1        | —         | `⚠` yellow                                |
| TX ID      | 6        | right     | `#{id}` prefixed                          |
| Source     | 10       | left      | Exchange/blockchain name                  |
| Timestamp  | 16       | left      | `YYYY-MM-DD HH:MM` (truncated to minutes) |
| Issue Type | 22       | left      | Snake_case type identifier                |
| Amount     | variable | right     | `{amount} {asset}` or `—` if none         |

### Issue Row Colors

| Element    | Color  |
| ---------- | ------ |
| Icon `⚠`   | yellow |
| TX ID      | white  |
| Source     | cyan   |
| Timestamp  | dim    |
| Issue type | white  |
| Amount     | green  |
| `—` (none) | dim    |

### Detail Panel

Shown below the divider for the selected issue:

```
▸ #{txId}  {issueType}  {source}  {fullTimestamp}
  Issue: {description}
  Amount: {amount} {asset}
  Suggestion: {suggestion}
```

| Element                                     | Color      |
| ------------------------------------------- | ---------- |
| TX ID                                       | white/bold |
| Issue type                                  | white      |
| Source                                      | cyan       |
| Timestamp                                   | dim        |
| Labels (`Issue:`, `Amount:`, `Suggestion:`) | dim        |
| Description                                 | white      |
| Amount                                      | green      |
| Suggestion                                  | white      |

- `Amount` line omitted when the issue has no amount
- `Suggestion` line omitted when no suggestion exists

### Sorting

Default: by timestamp ascending (oldest first).

### Scrolling

Same pattern as `links view`: visible window with `▲`/`▼` scroll indicators when list exceeds available height.

---

## Link Detail Layout

Shown when drilling into the Links category from the summary, or when launched with `--category links`.

### Header

```
Link Gaps                                 {total} issues · {inflows} uncovered inflows · {outflows} unmatched outflows
```

- Title: white/bold
- Counts: yellow when > 0, green when 0

### Asset Breakdown

A compact summary per affected asset, shown above the issue list:

```
  Asset Breakdown
    ETH     {n} inflows missing {amount} ETH · {n} outflow unmatched for {amount} ETH
    BTC     {n} inflow missing {amount} BTC
```

- Label `Asset Breakdown`: white/bold
- Asset symbols: white
- Amounts: green
- Direction labels: white
- Dot separator `·`: dim
- Only show directions with occurrences > 0
- Singular/plural: `1 inflow` vs `2 inflows`

### Issue List

```
{cursor} {icon}  #{txId}  {source}  {timestamp}  {asset}  {dir}  {missing} of {total}  {coverage}
```

| Column    | Width    | Alignment | Content                           |
| --------- | -------- | --------- | --------------------------------- |
| Cursor    | 1        | —         | `▸` for selected, space otherwise |
| Icon      | 1        | —         | `⚠` yellow                        |
| TX ID     | 6        | right     | `#{id}` prefixed                  |
| Source    | 10       | left      | Blockchain name or exchange name  |
| Timestamp | 16       | left      | `YYYY-MM-DD HH:MM`                |
| Asset     | 5        | left      | Asset symbol                      |
| Direction | 3        | left      | `IN` or `OUT`                     |
| Missing   | variable | right     | `{missing} of {total}`            |
| Coverage  | 10       | right     | `{pct}% covered`                  |

### Issue Row Colors

| Element   | Color                                |
| --------- | ------------------------------------ |
| Icon `⚠`  | yellow                               |
| TX ID     | white                                |
| Source    | cyan                                 |
| Timestamp | dim                                  |
| Asset     | white                                |
| `IN`      | green                                |
| `OUT`     | yellow                               |
| Amounts   | green                                |
| `of`      | dim                                  |
| Coverage  | green (≥50%), yellow (>0%), red (0%) |

### Detail Panel

```
▸ #{txId}  {source}  {operationCategory}/{operationType}  {fullTimestamp}
  Missing: {missing} {asset} of {total} {asset} {direction} ({coverage}% confirmed coverage)
  Suggested matches: {count} (best {confidence}% confidence)
  Action: {actionText}
```

| Element          | Color                      |
| ---------------- | -------------------------- |
| TX ID            | white/bold                 |
| Source           | cyan                       |
| Operation        | dim                        |
| Timestamp        | dim                        |
| Labels           | dim                        |
| Missing amount   | green                      |
| Total amount     | white                      |
| Direction label  | white                      |
| Coverage %       | colored by range           |
| Suggestion count | green when > 0, dim when 0 |
| Confidence       | colored by range           |
| Action text      | white                      |

- `Suggested matches` line: show `none` (dim) when 0 suggestions, omit confidence
- Action text varies by direction:
  - Inflow: `Run \`exitbook links run\` then confirm matches to bridge this gap.`
  - Outflow: `Identify the destination wallet or confirm a link; otherwise this may be treated as a gift.`

### Sorting

Default: by asset symbol ascending, then direction (inflows first), then timestamp ascending.

### Scrolling

Same pattern as fee detail.

---

## Keyboard Controls

### Summary View

| Key         | Action                       | Condition               |
| ----------- | ---------------------------- | ----------------------- |
| `↑` / `k`   | Move cursor up               | Always                  |
| `↓` / `j`   | Move cursor down             | Always                  |
| `Enter`     | Drill into selected category | Category is implemented |
| `q` / `Esc` | Quit                         | Always                  |

### Detail Views (Fee, Link)

| Key               | Action              | Condition                    |
| ----------------- | ------------------- | ---------------------------- |
| `↑` / `k`         | Move cursor up      | Always                       |
| `↓` / `j`         | Move cursor down    | Always                       |
| `PgUp` / `Ctrl-U` | Page up             | Always                       |
| `PgDn` / `Ctrl-D` | Page down           | Always                       |
| `Home`            | Jump to first issue | Always                       |
| `End`             | Jump to last issue  | Always                       |
| `Esc` / `←`       | Return to summary   | Always (unless `--category`) |
| `q`               | Quit                | Always                       |

When launched with `--category`, `Esc` quits (no summary to return to).

### Controls Bar

Summary view:

```
                                                  ↑↓ navigate  enter drill in  q quit
```

Detail view (navigated from summary):

```
                                    ↑↓/j/k · ^U/^D page · Home/End · esc/← summary · q quit
```

Detail view (launched with `--category`):

```
                                         ↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

---

## Empty States

### No Transactions

Shown when the database has no transactions at all.

```
Data Quality                                                     0 issues

  No transactions found. Import data first:
    exitbook import --exchange kraken --csv-dir ./exports/kraken

                                                                     q quit
```

### No Issues in Category

Shown when drilling into a category that has zero issues.

**Fee detail (clean):**

```
Fee Gaps                                            0 issues · all fees properly mapped

  No fee gaps found. All transactions have properly mapped fees.

                                                         esc/← summary  q quit
```

**Link detail (clean):**

```
Link Gaps                                            0 issues · all movements covered

  All movements have confirmed counterparties.

                                                         esc/← summary  q quit
```

### Unavailable Categories

Selecting prices or validation in the summary and pressing `Enter` does nothing — these rows are inert. Their dim `○` icon and `coming soon` label indicate they aren't interactive.

---

## Loading State

Before the TUI appears, a standard spinner:

```
⠋ Analyzing data quality...
```

- Both fee and link analyses run during loading (for the summary)
- When `--category fees`, only fee analysis runs
- When `--category links`, only link analysis runs

---

## JSON Mode (`--json`)

Bypasses the TUI entirely. Outputs structured JSON.

### All Categories (default)

```json
{
  "data": {
    "fees": {
      "issues": [...],
      "summary": {
        "total_issues": 8,
        "affected_transactions": 6,
        "by_type": {
          "fee_without_price": 5,
          "missing_fee_fields": 2,
          "fee_in_movements": 1,
          "outflow_without_fee_field": 0
        }
      }
    },
    "links": {
      "issues": [...],
      "summary": {
        "total_issues": 5,
        "uncovered_inflows": 3,
        "unmatched_outflows": 2,
        "affected_assets": 2,
        "assets": [...]
      }
    },
    "prices": null,
    "validation": null
  },
  "meta": {
    "total_issues": 13,
    "categories": {
      "fees": { "available": true, "issue_count": 8 },
      "links": { "available": true, "issue_count": 5 },
      "prices": { "available": false },
      "validation": { "available": false }
    }
  }
}
```

### Single Category (`--category fees --json`)

```json
{
  "data": {
    "issues": [...],
    "summary": {
      "total_issues": 8,
      "affected_transactions": 6,
      "by_type": {
        "fee_without_price": 5,
        "missing_fee_fields": 2,
        "fee_in_movements": 1,
        "outflow_without_fee_field": 0
      }
    }
  },
  "meta": {
    "category": "fees",
    "total_issues": 8
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as `links view` and `links run`.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning              |
| ---- | ------ | -------------------- |
| `✓`  | green  | Clean / no issues    |
| `⚠`  | yellow | Issues found         |
| `○`  | dim    | Unavailable          |
| `▸`  | —      | Cursor (bold on row) |

**Content tier (what you read):**

| Element                 | Color                                     |
| ----------------------- | ----------------------------------------- |
| Category names          | white                                     |
| Asset symbols           | white                                     |
| Amounts                 | green                                     |
| Source/blockchain names | cyan                                      |
| Issue type identifiers  | white                                     |
| Direction `IN`          | green                                     |
| Direction `OUT`         | yellow                                    |
| Issue counts (header)   | yellow when > 0, green when 0             |
| Coverage %              | green (≥50%), yellow (>0%), red (0%)      |
| Confidence %            | green (≥95%), yellow (70–95%), red (<70%) |
| `coming soon`           | dim                                       |
| Clean messages          | dim                                       |

**Context tier (recedes):**

| Element                            | Color |
| ---------------------------------- | ----- |
| Timestamps                         | dim   |
| Divider `─`                        | dim   |
| Labels (`Issue:`, `Amount:`, etc.) | dim   |
| Operation type in detail           | dim   |
| Dot separator `·`                  | dim   |
| `of` in amount expressions         | dim   |
| Controls bar                       | dim   |
| Scroll indicators                  | dim   |
| `—` (no amount)                    | dim   |

---

## State Model

```typescript
/** Top-level navigation */
type GapsScreen = 'summary' | 'fee-detail' | 'link-detail';

/** Summary category entry */
interface GapsCategorySummary {
  category: GapCategory;
  available: boolean;
  issueCount: number;
  oneLiner: string;
}

/** Gaps TUI state */
interface GapsState {
  // Screen
  screen: GapsScreen;

  // Summary view
  categories: GapsCategorySummary[];
  summarySelectedIndex: number;

  // Fee detail view
  feeAnalysis: FeeGapAnalysis | undefined;
  feeSelectedIndex: number;
  feeScrollOffset: number;

  // Link detail view
  linkAnalysis: LinkGapAnalysis | undefined;
  linkSelectedIndex: number;
  linkScrollOffset: number;

  // Total across all categories
  totalIssues: number;

  // Whether launched with --category (disables back navigation)
  directCategory: boolean;
}
```

### Actions

```typescript
type GapsAction =
  // Summary navigation
  | { type: 'SUMMARY_UP' }
  | { type: 'SUMMARY_DOWN' }
  | { type: 'DRILL_IN' }

  // Detail navigation
  | { type: 'DETAIL_UP'; visibleRows: number }
  | { type: 'DETAIL_DOWN'; visibleRows: number }
  | { type: 'DETAIL_PAGE_UP'; visibleRows: number }
  | { type: 'DETAIL_PAGE_DOWN'; visibleRows: number }
  | { type: 'DETAIL_HOME' }
  | { type: 'DETAIL_END'; visibleRows: number }

  // Back to summary
  | { type: 'BACK_TO_SUMMARY' };
```

### Initial State Factory

```typescript
function createGapsState(
  feeAnalysis: FeeGapAnalysis | undefined,
  linkAnalysis: LinkGapAnalysis | undefined,
  directCategory?: GapCategory
): GapsState;
```

- When `directCategory` is set, `screen` starts at the corresponding detail view and `directCategory` is `true`
- When not set, `screen` starts at `'summary'` and both analyses are available

---

## Component Structure

```
GapsApp
├── SummaryView (screen === 'summary')
│   ├── Header ("Data Quality" + total count)
│   ├── CategoryList
│   │   └── CategoryRow (one per category)
│   └── ControlsBar
├── FeeDetailView (screen === 'fee-detail')
│   ├── Header ("Fee Gaps" + counts)
│   ├── TypeSummary (breakdown by fee gap type)
│   ├── FeeIssueList (scrollable)
│   │   └── FeeIssueRow
│   ├── Divider
│   ├── FeeDetailPanel (selected issue)
│   └── ControlsBar
└── LinkDetailView (screen === 'link-detail')
    ├── Header ("Link Gaps" + counts)
    ├── AssetBreakdown (per-asset summary)
    ├── LinkIssueList (scrollable)
    │   └── LinkIssueRow
    ├── Divider
    ├── LinkDetailPanel (selected issue)
    └── ControlsBar
```

---

## Command Options

```
exitbook gaps [options]

Options:
  --category <category>   Filter by gap category (fees, links)
  --json                  Output results in JSON format
  -h, --help              Display help
```

### Validation

- `--category` accepts only `fees` and `links` (reject `prices` and `validation` with "not yet implemented" error)
- `--json` and `--category` can be combined
- No `--category` flag shows the interactive summary

---

## Implementation Notes

### Data Flow

1. Initialize database, create `TransactionRepository` and `TransactionLinkRepository`
2. Fetch all transactions once
3. Run `analyzeFeeGaps(transactions)` — always, unless `--category links`
4. Run `analyzeLinkGaps(transactions, links)` — always, unless `--category fees` (requires fetching links)
5. Build initial state from analyses
6. Render Ink TUI (or output JSON)
7. Close database before TUI renders (read-only, all data in memory)

### Terminal Size

- Summary view: 4 category rows (fixed, no scrolling needed)
- Detail views: list panel fills available height minus type summary/asset breakdown (variable, ~4 lines), divider (1), detail panel (5), header (2), controls (1), spacing (3)
- Minimum terminal width: 80 columns
- Detail panel: fixed 4–5 lines depending on content

### Shared Components

Reuse from `apps/cli/src/ui/shared/`:

- `formatDuration` for loading spinner duration
- Status icon conventions (but custom icons for gap categories)
- `TreeChars` not needed (no tree structure in gaps)

### Migration Path

1. Create `apps/cli/src/ui/gaps/` directory with state, controller, and components
2. Register `exitbook gaps` as a top-level command (alongside `exitbook links`, `exitbook import`, etc.)
3. Deprecate `exitbook gaps view` subcommand (keep as alias initially, remove later)
4. Existing analysis functions in `gaps-view-utils.ts` remain unchanged — they produce the data, the TUI consumes it

### Accessibility

- Vim keys (`j`/`k`) alongside arrows for all navigation
- No color-only information — status text and icons always accompany colors
- Unavailable categories clearly labeled `coming soon`, not just dimmed
- Direction always shown as text (`IN`/`OUT`), not just color-coded
