# Links View — Interactive TUI Spec

## Overview

`exitbook links view` is a two-mode TUI for inspecting transfer links and diagnosing coverage gaps.

- **Links mode** (default): Browse links between transactions — confirm or reject suggestions inline.
- **Gaps mode** (`--status gaps`): Browse movements that lack confirmed counterparties — uncovered inflows and unmatched outflows.

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

| Key               | Action           | When   |
| ----------------- | ---------------- | ------ |
| `↑` / `k`         | Move cursor up   | Always |
| `↓` / `j`         | Move cursor down | Always |
| `PgUp` / `Ctrl-U` | Page up          | Always |
| `PgDn` / `Ctrl-D` | Page down        | Always |
| `Home`            | Jump to first    | Always |
| `End`             | Jump to last     | Always |
| `q` / `Esc`       | Quit             | Always |

`PgUp`/`PgDn` depend on terminal settings; `Ctrl-U`/`Ctrl-D` are the reliable paging shortcuts.

### Controls Bar

Bottom line, dim. Content adapts to mode and selection state.

### Loading State

```
⠋ Loading transaction links...
```

Brief spinner, then TUI appears.

### Error State

Transient error line appears below the detail panel, cleared on next navigation.

---

## Links Mode

Default mode. Shows transfer links grouped by status.

### Visual Example

```
Transaction Links  3 confirmed · 4 suggested · 1 rejected

  ✓  a1b2c3d4  ETH    1.5000 → 1.4985   kraken → ethereum           100.0%  confirmed
  ✓  e5f6g7h8  BTC    0.5000 → 0.4998   kraken → bitcoin             98.2%  confirmed
  ✓  i9j0k1l2  SOL   50.0000 → 49.9500  kucoin → solana              96.1%  confirmed
▸ ⚠  m3n4o5p6  ETH    2.0000 → 1.9970   coinbase → ethereum          82.4%  suggested
  ⚠  q7r8s9t0  BTC    0.1000 → 0.0995   kraken → bitcoin             74.8%  suggested
  ⚠  u1v2w3x4  MATIC   100.0 → 99.5000  kucoin → polygon             71.2%  suggested
  ⚠  y5z6a7b8  DOT   25.0000 → 24.8000  kraken → polkadot            70.5%  suggested
  ✗  c9d0e1f2  ETH    3.0000 → 2.8500   kraken → ethereum            52.1%  rejected

────────────────────────────────────────────────────────────────────────────────────────────
▸ m3n4o5p6  ETH  exchange to blockchain  82.4%  suggested

  Source: #1234 coinbase   2024-03-15 14:23:41   OUT 2.0000 ETH
  Target: #5678 ethereum   2024-03-15 14:25:12   IN  1.9970 ETH

  Match: asset · amount 99.8% · timing 0.03h

↑↓/j/k · ^U/^D page · Home/End · c confirm · r reject · q/esc quit
```

### Header

```
Transaction Links  {confirmed} confirmed · {suggested} suggested · {rejected} rejected
```

- Title: white/bold
- Counts: green for confirmed, yellow for suggested, dim for rejected
- Dot separators: dim
- When `--limit` truncates: append `· showing {displayed} of {total}` (dim)

When filtered by status:

```
Transaction Links (suggested)  4 suggested
```

### List Columns

```
{cursor} {icon}  {id}  {asset}  {sourceAmt} → {targetAmt}   {source} → {target}   {confidence}  {status}
```

| Column          | Width    | Alignment | Content                                          |
| --------------- | -------- | --------- | ------------------------------------------------ |
| Cursor          | 1        | —         | `▸` for selected row, space otherwise            |
| Icon            | 1        | —         | Status icon                                      |
| ID              | 8        | left      | First 8 chars of link UUID                       |
| Asset           | 5        | left      | Asset symbol, truncated                          |
| Source Amount   | 15       | right     | Locale-formatted (commas, max 4 decimal places)  |
| Arrow           | 1        | —         | `→`                                              |
| Target Amount   | 15       | right     | Same format                                      |
| Source → Target | variable | left      | `{sourceName} → {targetName}`, padded to 30 wide |
| Confidence      | 6        | right     | `XX.X%`                                          |
| Status          | 9        | left      | `confirmed` / `suggested` / `rejected`           |

### Status Icons

| Status    | Icon | Color  |
| --------- | ---- | ------ |
| confirmed | `✓`  | green  |
| suggested | `⚠`  | yellow |
| rejected  | `✗`  | dim    |

### Row Colors

| Row State         | Color                     |
| ----------------- | ------------------------- |
| Selected (cursor) | white/bold for entire row |
| Confirmed         | normal white              |
| Suggested         | normal white, icon yellow |
| Rejected          | dim for entire row        |

### Detail Panel

```
▸ {id}  {asset}  {linkType}  {confidence}  {status}

  Source: #{txId} {sourceName}   {timestamp}   {direction} {amount} {asset}
  Target: #{txId} {targetName}   {timestamp}   {direction} {amount} {asset}

  Match: {criteria}
```

| Element                              | Color                                     |
| ------------------------------------ | ----------------------------------------- |
| Selected ID                          | white/bold                                |
| Asset                                | white                                     |
| Link type (`exchange to blockchain`) | dim                                       |
| Confidence                           | green (≥95%), yellow (70–95%), red (<70%) |
| Status                               | green/yellow/dim matching icon colors     |
| `Source:` / `Target:` labels         | dim                                       |
| Transaction IDs `#1234`              | white                                     |
| Source names                         | cyan                                      |
| Timestamps                           | dim                                       |
| Direction (`OUT`, `IN`)              | green for IN, yellow for OUT              |
| Amounts                              | green                                     |
| `Match:` label                       | dim                                       |
| Match criteria values                | white                                     |

### Match Criteria

```
asset · amount 99.8% · timing 0.03h · address
```

Only show criteria that are present/true. Separated by `·`.

### Verbose Mode (`--verbose`)

Adds address information to the detail panel:

```
▸ m3n4o5p6  ETH  exchange to blockchain  82.4%  suggested

  Source: #1234 coinbase   2024-03-15 14:23:41   OUT 2.0000 ETH
  Target: #5678 ethereum   2024-03-15 14:25:12   IN  1.9970 ETH
          from: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38
          to:   0x1234567890abcdef1234567890abcdef12345678

  Match: asset · amount 99.8% · timing 0.03h · address
```

### Confirm/Reject

| Key | Action  | When                         |
| --- | ------- | ---------------------------- |
| `c` | Confirm | Selected link is `suggested` |
| `r` | Reject  | Selected link is `suggested` |

Behavior:

1. Link status updates immediately in the list (optimistic)
2. Database update happens asynchronously
3. If DB update fails, status reverts and error appears below detail panel
4. Header counts update to reflect new totals

No confirmation dialog — instant action for fast triage.

### Controls Bar

When selected link is suggested:

```
↑↓/j/k · ^U/^D page · Home/End · c confirm · r reject · q/esc quit
```

Otherwise:

```
↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

### Sorting

Default: by status group (confirmed → suggested → rejected), then by confidence descending within each group.

---

## Gaps Mode

Activated by `--status gaps`. Shows movements that lack confirmed link coverage. Read-only (no mutations).

### Visual Example

```
Transaction Links (gaps)  3 uncovered inflows · 2 unmatched outflows

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

↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

### Header

```
Transaction Links (gaps)  {inflows} uncovered inflows · {outflows} unmatched outflows
```

- Title: white/bold
- Counts: yellow when > 0, green when 0
- Dot separator: dim

### Asset Breakdown

Compact per-asset summary, shown between header and list:

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

### List Columns

```
{cursor} {icon}  #{txId}  {source}  {timestamp}  {asset}  {dir}  {missing} of {total}  {coverage}
```

| Column    | Width    | Alignment | Content                           |
| --------- | -------- | --------- | --------------------------------- |
| Cursor    | 1        | —         | `▸` for selected, space otherwise |
| Icon      | 1        | —         | `⚠` yellow (all rows are issues)  |
| TX ID     | 6        | right     | `#{id}` prefixed                  |
| Source    | 10       | left      | Blockchain name or exchange name  |
| Timestamp | 16       | left      | `YYYY-MM-DD HH:MM`                |
| Asset     | 5        | left      | Asset symbol                      |
| Direction | 3        | left      | `IN` or `OUT`                     |
| Missing   | variable | right     | `{missing} of {total}`            |
| Coverage  | 10       | right     | `{pct}% covered`                  |

### Row Colors

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

### Controls Bar

```
↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

No `c`/`r` — gaps mode is read-only.

### Sorting

Default: by asset symbol ascending, then direction (inflows first), then timestamp ascending.

---

## Filters

### Status Filter (`--status`)

```bash
exitbook links view                     # All links (default)
exitbook links view --status suggested  # Only suggested links
exitbook links view --status confirmed  # Only confirmed links
exitbook links view --status rejected   # Only rejected links
exitbook links view --status gaps       # Coverage gap analysis
```

### Confidence Filter

Only applies in links mode. Ignored when `--status gaps`.

```bash
exitbook links view --min-confidence 0.8                         # High confidence only
exitbook links view --min-confidence 0.3 --max-confidence 0.7   # Medium range
```

### Limit

```bash
exitbook links view --limit 20
```

Applies to both modes. In links mode, header shows `showing X of Y` when truncated.

### Verbose

Only applies in links mode. Adds address details to the detail panel.

```bash
exitbook links view --verbose
```

---

## Empty States

### No Links at All (links mode)

```
Transaction Links  0 links

  No transaction links found.

  Run the linking algorithm first:
  exitbook links run

q quit
```

### No Links Matching Filter (links mode)

```
Transaction Links (suggested)  0 suggested

  No suggested links found.

q quit
```

### No Gaps Found (gaps mode)

```
Transaction Links (gaps)  0 gaps

  All movements have confirmed counterparties.

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Output shape depends on mode.

### Links Mode

```json
{
  "data": [...],
  "meta": {
    "total": 8,
    "confirmed": 3,
    "suggested": 4,
    "rejected": 1,
    "filters": {}
  }
}
```

### Gaps Mode (`--status gaps --json`)

```json
{
  "data": [...],
  "meta": {
    "total_issues": 5,
    "uncovered_inflows": 3,
    "unmatched_outflows": 2,
    "affected_assets": 2,
    "assets": [...]
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as ingestion dashboard and links-run.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning               |
| ---- | ------ | --------------------- |
| `✓`  | green  | Confirmed link        |
| `⚠`  | yellow | Suggested / gap issue |
| `✗`  | dim    | Rejected link         |
| `▸`  | —      | Cursor (bold)         |

**Content tier (what you read):**

| Element                 | Color                                     |
| ----------------------- | ----------------------------------------- |
| Asset symbols           | white                                     |
| Amounts                 | green                                     |
| Source/blockchain names | cyan                                      |
| Confidence %            | green (≥95%), yellow (70–95%), red (<70%) |
| Status text             | matches icon color                        |
| Counts in header        | matches status color                      |
| Direction `IN`          | green                                     |
| Direction `OUT`         | yellow                                    |
| Coverage %              | green (≥50%), yellow (>0%), red (0%)      |

**Context tier (recedes):**

| Element                            | Color |
| ---------------------------------- | ----- |
| Timestamps                         | dim   |
| Divider `─`                        | dim   |
| Link type                          | dim   |
| Arrow `→`                          | dim   |
| Dot separator `·`                  | dim   |
| `of` in amount expressions         | dim   |
| Labels (`Source:`, `Match:`, etc.) | dim   |
| Operation type in detail           | dim   |
| Controls bar                       | dim   |
| Scroll indicators                  | dim   |
| `showing X of Y`                   | dim   |

---

## State Model

```typescript
/** Links mode state */
interface LinksViewLinksState {
  mode: 'links';

  links: LinkWithTransactions[];
  counts: { confirmed: number; suggested: number; rejected: number };

  selectedIndex: number;
  scrollOffset: number;

  statusFilter?: LinkStatus | undefined;
  totalCount?: number | undefined;
  verbose: boolean;

  pendingAction?: { linkId: string; action: 'confirm' | 'reject' } | undefined;
  error?: string | undefined;
}

/** Gaps mode state */
interface LinksViewGapsState {
  mode: 'gaps';

  linkAnalysis: LinkGapAnalysis;
  selectedIndex: number;
  scrollOffset: number;
}

type LinksViewState = LinksViewLinksState | LinksViewGapsState;
```

### Actions

```typescript
type LinksViewAction =
  // Navigation (both modes)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Links mode only
  | { type: 'CONFIRM_SELECTED' }
  | { type: 'REJECT_SELECTED' }

  // Error handling
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR'; error: string };
```

---

## Component Structure

```
LinksViewApp
├── Header (adapts to mode)
├── AssetBreakdown (gaps mode only)
├── LinkList (links mode) / GapList (gaps mode)
│   └── LinkRow / GapRow
├── Divider
├── LinkDetailPanel (links mode) / GapDetailPanel (gaps mode)
├── ErrorLine (transient, if present)
└── ControlsBar (adapts: c/r only in links mode on suggested)
```

---

## Command Options

```
exitbook links view [options]

Options:
  --status <status>          Filter by status (suggested, confirmed, rejected, gaps)
  --min-confidence <score>   Minimum confidence score 0-1 (links mode only)
  --max-confidence <score>   Maximum confidence score 0-1 (links mode only)
  --limit <number>           Maximum items to display
  --verbose                  Include address details (links mode only)
  --json                     Output JSON, bypass TUI
  -h, --help                 Display help
```

---

## Implementation Notes

### Data Flow

**Links mode:**

1. Fetch links from `TransactionLinkRepository.findAll(status?)`
2. For each link, fetch source and target transactions
3. Apply confidence filters client-side
4. Apply limit
5. Create `LinksConfirmHandler` and `LinksRejectHandler` for inline actions
6. Render Ink TUI with dataset in memory

**Gaps mode:**

1. Fetch all transactions from `TransactionRepository`
2. Fetch all links from `TransactionLinkRepository.findAll()`
3. Run `analyzeLinkGaps(transactions, links)` to produce `LinkGapAnalysis`
4. Render Ink TUI with analysis in memory

Database is kept open in links mode (for confirm/reject writes). In gaps mode, database can be closed after loading (read-only).

### Terminal Size

- List panel: fills available height minus fixed chrome (header ~3, divider 1, detail panel ~6, controls ~2, scroll indicators ~2 = ~14 lines)
- Gaps mode: asset breakdown adds ~4 lines above the list, reducing visible rows further
- Minimum terminal width: 80 columns
- Detail panel: ~6 lines including blank lines between sections

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — status text and icons always accompany colors
- Direction always shown as text (`IN`/`OUT`), not just color-coded

### Migration from `gaps` Command

The `analyzeLinkGaps` function moves from `features/gaps/gaps-view-utils.ts` into `features/links/`. The `gaps` command, `GapCategory` type, `FeeGapAnalysis`, `analyzeFeeGaps`, and all fee gap types are removed. The `GapsViewCommandOptionsSchema` in shared schemas is removed. `LinksViewCommandOptionsSchema` gains `'gaps'` as a status enum value.
