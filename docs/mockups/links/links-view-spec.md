# Links View — Interactive TUI Spec

## Overview

`exitbook links view` displays transaction links in an interactive Ink TUI. Users navigate a list with arrow keys, inspect link details, and confirm/reject suggested links inline. `--json` mode bypasses the TUI for scripting.

---

## Layout

Two-panel layout: **list** (top) and **detail** (bottom), separated by a divider.

### Full View

```
Transaction Links                              3 confirmed · 4 suggested · 1 rejected

  ✓  a1b2c3d4  ETH    1.5000 → 1.4985   kraken → ethereum           100.0%  confirmed
  ✓  e5f6g7h8  BTC    0.5000 → 0.4998   kraken → bitcoin             98.2%  confirmed
  ✓  i9j0k1l2  SOL   50.0000 → 49.9500  kucoin → solana              96.1%  confirmed
▸ ⚠  m3n4o5p6  ETH    2.0000 → 1.9970   coinbase → ethereum          82.4%  suggested
  ⚠  q7r8s9t0  BTC    0.1000 → 0.0995   kraken → bitcoin             74.8%  suggested
  ⚠  u1v2w3x4  MATIC   100.0 → 99.5000  kucoin → polygon             71.2%  suggested
  ⚠  y5z6a7b8  DOT   25.0000 → 24.8000  kraken → polkadot            70.5%  suggested
  ✗  c9d0e1f2  ETH    3.0000 → 2.8500   kraken → ethereum            52.1%  rejected

────────────────────────────────────────────────────────────────────────────────────────────
▸ m3n4o5p6  ETH  exchange_to_blockchain  82.4%  suggested
  Source: #1234 coinbase   2024-03-15 14:23:41   OUT 2.0000 ETH
  Target: #5678 ethereum   2024-03-15 14:25:12   IN  1.9970 ETH
  Match: asset · amount 99.8% · timing 0.03h

                                                    ↑↓ navigate  c confirm  r reject  q quit
```

---

## List Panel

### Column Layout

```
{cursor} {icon}  {id}  {asset}  {sourceAmt} → {targetAmt}   {source} → {target}   {confidence}  {status}
```

| Column          | Width    | Alignment | Content                                |
| --------------- | -------- | --------- | -------------------------------------- |
| Cursor          | 1        | —         | `▸` for selected row, space otherwise  |
| Icon            | 1        | —         | Status icon (see below)                |
| ID              | 8        | left      | First 8 chars of link UUID             |
| Asset           | 5        | left      | Asset symbol, truncated                |
| Source Amount   | 10       | right     | `.toFixed()` with locale formatting    |
| Arrow           | 1        | —         | `→`                                    |
| Target Amount   | 10       | right     | Same format                            |
| Source → Target | variable | left      | `{sourceName} → {targetName}`          |
| Confidence      | 6        | right     | `XX.X%`                                |
| Status          | 9        | left      | `confirmed` / `suggested` / `rejected` |

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

### Header

```
Transaction Links                              {confirmed} confirmed · {suggested} suggested · {rejected} rejected
```

- Title: white/bold
- Counts: green for confirmed, yellow for suggested, dim for rejected
- Dot separators: dim

### Sorting

Default: by status group (confirmed → suggested → rejected), then by confidence descending within each group.

### Scrolling

When list exceeds terminal height minus detail panel height:

- Show visible window with scroll indicators
- Selected row always visible (scroll to keep in view)
- No explicit scroll bar — just `▲` / `▼` indicators at top/bottom when more items exist

---

## Detail Panel

Shows expanded information for the currently selected link. Separated from list by a full-width dim `─` divider.

### Layout

```
▸ {id}  {asset}  {linkType}  {confidence}  {status}
  Source: #{txId} {sourceName}   {timestamp}   {direction} {amount} {asset}
  Target: #{txId} {targetName}   {timestamp}   {direction} {amount} {asset}
  Match: {criteria}
```

### Detail Colors

| Element                              | Color                                     |
| ------------------------------------ | ----------------------------------------- |
| Selected ID                          | white/bold                                |
| Asset                                | white                                     |
| Link type (`exchange_to_blockchain`) | dim                                       |
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

Format: `{criterion} · {criterion} · ...`

```
asset · amount 99.8% · timing 0.03h · address
```

Only show criteria that are present/true. Each separated by `·`.

---

## Verbose Mode (`--verbose`)

Adds address information to the detail panel:

```
▸ m3n4o5p6  ETH  exchange_to_blockchain  82.4%  suggested
  Source: #1234 coinbase   2024-03-15 14:23:41   OUT 2.0000 ETH
  Target: #5678 ethereum   2024-03-15 14:25:12   IN  1.9970 ETH
          from: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38
          to:   0x1234567890abcdef1234567890abcdef12345678
  Match: asset · amount 99.8% · timing 0.03h · address
```

---

## Keyboard Controls

| Key            | Action                | When                         |
| -------------- | --------------------- | ---------------------------- |
| `↑` / `k`      | Move cursor up        | Always                       |
| `↓` / `j`      | Move cursor down      | Always                       |
| `c`            | Confirm selected link | Selected link is `suggested` |
| `r`            | Reject selected link  | Selected link is `suggested` |
| `q` / `Ctrl-C` | Quit                  | Always                       |

### Confirm/Reject Behavior

When the user presses `c` or `r` on a suggested link:

1. The link status updates immediately in the list (icon changes, status text changes)
2. The database update happens asynchronously
3. If the DB update fails, the status reverts and an error message appears briefly below the detail panel
4. Header counts update to reflect the new totals

No confirmation dialog — the action is instant. This keeps the flow fast for triaging many suggested links.

### Controls Bar

Bottom of screen, dim:

```
                                                    ↑↓ navigate  c confirm  r reject  q quit
```

Only show `c confirm  r reject` when selected link is `suggested`.

```
                                                                        ↑↓ navigate  q quit
```

---

## Filters

### Status Filter (`--status`)

```bash
exitbook links view --status suggested    # Only suggested links
exitbook links view --status confirmed    # Only confirmed links
exitbook links view --status rejected     # Only rejected links
```

When filtered, header reflects the filter:

```
Transaction Links (suggested)                                              4 suggested
```

### Confidence Filter

```bash
exitbook links view --min-confidence 0.8                    # High confidence only
exitbook links view --min-confidence 0.3 --max-confidence 0.7   # Medium range
```

### Limit

```bash
exitbook links view --limit 20
```

---

## Empty States

### No Links at All

```
Transaction Links                                                          0 links

  No transaction links found.

  Run the linking algorithm first:
    exitbook links run

                                                                              q quit
```

### No Links Matching Filter

```
Transaction Links (suggested)                                     0 suggested

  No suggested links found.

                                                                              q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI entirely. Same output as current implementation but with richer transaction details:

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

---

## Loading State

While fetching links and transactions from the database:

```
⠋ Loading transaction links...
```

Brief spinner, then TUI appears. If loading takes >2s (unlikely for local SQLite), show count progress.

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as ingestion dashboard and links-run.

**Signal tier:**

- `✓` green, `⚠` yellow, `✗` dim
- Cursor `▸` white/bold

**Content tier:**

- Asset symbols: white
- Amounts: green
- Source names: cyan
- Confidence: colored by range (green ≥95%, yellow 70–95%, red <70%)
- Status text: matches icon color
- Counts in header: matches status color

**Context tier:**

- Timestamps: dim
- Link type: dim
- Divider: dim
- Arrow `→`: dim
- Controls bar: dim
- Tree chars in detail panel: dim

---

## Implementation Notes

### Data Flow

1. Fetch all links from `TransactionLinkRepository.findAll(status?)`
2. For each link, fetch source and target transactions from `TransactionRepository.findById()`
3. Apply confidence filters client-side
4. Render Ink TUI with full dataset in memory

### Component Structure

```
LinksViewApp
├── Header (title + counts)
├── LinkList (scrollable list with cursor)
│   └── LinkRow (one per link)
├── Divider
├── DetailPanel (selected link details)
└── ControlsBar (keyboard hints)
```

### State

```typescript
interface LinksViewState {
  links: LinkWithTransactions[];
  selectedIndex: number;
  scrollOffset: number;
  counts: { confirmed: number; suggested: number; rejected: number };
  pendingAction?: { linkId: string; action: 'confirm' | 'reject' };
  error?: string;
}
```

### Confirm/Reject Integration

The TUI calls `TransactionLinkRepository.updateStatus()` directly. This is the same code path as `links confirm` and `links reject` CLI commands — the TUI just provides a faster UX for bulk triage.

### Terminal Size

- List panel: fills available height minus detail panel (4 lines) minus header (2 lines) minus controls (1 line)
- Minimum terminal width: 80 columns (truncate source→target names if narrower)
- Detail panel: fixed 4 lines

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — status text always accompanies icons
