# Clear Data — Interactive TUI Spec

## Overview

`exitbook clear` is an interactive TUI for previewing and confirming data deletion. It combines a structured preview of affected data categories with an inline confirmation workflow.

Four-phase design: **preview** (browse data categories, toggle include-raw), **confirm** (double-press `d`), **execute** (brief progress), **complete** (result summary).

Unlike view commands that browse large datasets, clear always shows a fixed set of data categories with counts. The two-panel layout is still used — the list shows categories, and the detail panel explains each one and its recovery path.

`--confirm` skips the TUI and executes immediately (scripting). `--json` bypasses the TUI.

---

## Two-Panel Layout

List (top) and detail panel (bottom), separated by a full-width dim `─` divider. Same shared behavior as all other TUI views.

### Scrolling

Not needed in practice — all categories fit on screen (max 9 rows). Scroll behavior included for consistency but unlikely to trigger.

### Navigation

| Key               | Action           | When             |
| ----------------- | ---------------- | ---------------- |
| `↑` / `k`         | Move cursor up   | Preview/complete |
| `↓` / `j`         | Move cursor down | Preview/complete |
| `PgUp` / `Ctrl-U` | Page up          | Preview/complete |
| `PgDn` / `Ctrl-D` | Page down        | Preview/complete |
| `Home`            | Jump to first    | Preview/complete |
| `End`             | Jump to last     | Preview/complete |
| `d`               | Delete           | Preview          |
| `d`               | Confirm          | Confirming       |
| `r`               | Toggle raw       | Preview          |
| `q` / `Esc`       | Cancel/quit      | Always           |

### Controls Bar

Bottom line, dim. Content adapts to phase.

### Loading State

```
⠋ Previewing deletion...
```

Brief spinner while counting items, then TUI appears.

### Empty State

When there's no data to delete (all categories are empty), the TUI still renders showing all categories with zero counts. The delete action (`d` key) is disabled, but the toggle raw (`r` key) remains available since toggling might reveal deletable items.

```
Clear Data — all accounts · 0 items · raw data: preserved

  · Transactions                    0
▸ · Transaction links               0
  · Accounts                        0
  ✓ Import sessions               160 (preserved)
  ✓ Raw data items             56,523 (preserved)
────────────────────────────────────────────────────────────────────────────────
  Transaction links
  Transfer link matches between outflows and inflows

  No data to clear. All categories are empty.

  No items to delete

↑↓/j/k · r toggle raw · q exit
```

**Controls:**

- Navigation enabled (browse categories)
- `r` toggle enabled (may reveal deletable items)
- `d` delete disabled (nothing to delete)
- `q` exits instead of cancels

---

## Visual Example (Preview Phase)

```
Clear data — all accounts · 360 items · raw data: preserved

  ✗ Transactions                  312 (will delete)
▸ ✗ Transaction links              48 (will delete)
  · Accounts                        0
  ✓ Import sessions                 5 (preserved)
  ✓ Raw data items              1,204 (preserved)

────────────────────────────────────────────────────────────────────────────────
Transaction links
Transfer link matches between outflows and inflows

48 items will be deleted

↑↓/j/k · d delete · r toggle raw · q cancel
```

### With --include-raw

```
Clear data — all accounts · 1,572 items · raw data: included

  ✗ Transactions                  312 (will delete)
  ✗ Transaction links              48 (will delete)
  ✗ Accounts                        3 (will delete)
  ✗ Import sessions                 5 (will delete)
▸ ✗ Raw data items              1,204 (will delete)

────────────────────────────────────────────────────────────────────────────────
Raw data items
Original imported data from exchanges and blockchains

1,204 items will be deleted

↑↓/j/k · d delete · r toggle raw · q cancel
```

### With --source Filter

```
Clear data — (kraken) · 226 items · raw data: preserved

  ✗ Transactions                  198 (will delete)
▸ ✗ Transaction links              28 (will delete)
  · Accounts                        0
  ✓ Import sessions                 2 (preserved)
  ✓ Raw data items                612 (preserved)

────────────────────────────────────────────────────────────────────────────────
...
```

### With --account-id Filter

```
Clear data — (#4 bitcoin) · 89 items · raw data: preserved

  ✗ Transactions                   56 (will delete)
  ...
```

---

## Header

```
Clear data — {scope} · {totalItems} items · raw data: {rawStatus}
```

- Title: `Clear data` white/bold
- Scope separator: `—` dim
- Scope label: white
- Dot separators: `·` dim
- Total items: `{count} items` white
- Raw status label: `raw data: ` dim
- Raw status value:
  - `preserved` green when includeRaw is off
  - `included` red when includeRaw is on

The "items" count shows only items that WILL be deleted (excludes preserved).

### Scope Labels

| Filter Type    | Display            | Example                     |
| -------------- | ------------------ | --------------------------- |
| None           | `all accounts`     | `Clear data — all accounts` |
| `--source`     | `({source})`       | `Clear data — (kraken)`     |
| `--account-id` | `(#{id} {source})` | `Clear data — (#4 bitcoin)` |

---

## List Rows

```
{cursor} {icon}  {category}  {count}  {status}
```

| Column   | Width | Alignment | Content                                    |
| -------- | ----- | --------- | ------------------------------------------ |
| Cursor   | 1     | —         | `▸` for selected, space otherwise          |
| Icon     | 1     | —         | Deletion/preserved status icon             |
| Category | 26    | left      | Data category name                         |
| Count    | 8     | right     | Item count, locale-formatted               |
| Status   | 10    | left      | `preserved` for raw data when not included |

### Data Categories (row order)

**Processed data** (always deleted when count > 0):

| Row | Key          | Label             |
| --- | ------------ | ----------------- |
| 1   | transactions | Transactions      |
| 2   | links        | Transaction links |

**Raw data** (preserved by default, deleted with include-raw):

| Row | Key      | Label           |
| --- | -------- | --------------- |
| 3   | accounts | Accounts        |
| 4   | sessions | Import sessions |
| 5   | rawData  | Raw data items  |

### Icons

| Condition                          | Icon | Color |
| ---------------------------------- | ---- | ----- |
| Will delete (count > 0)            | `✗`  | red   |
| Nothing to delete (count = 0)      | `·`  | dim   |
| Preserved (raw data, not included) | `✓`  | green |

### Row Colors

| Row State                   | Color                                   |
| --------------------------- | --------------------------------------- |
| Selected (cursor)           | white/bold for entire row               |
| Will delete (count > 0)     | white text, red icon                    |
| Nothing to delete (count 0) | dim for entire row                      |
| Preserved                   | dim text, green icon, green `preserved` |

### Raw Data Row Display

When `includeRaw` is off, raw data rows always show the ACTUAL item counts (from the pre-fetched include-raw preview) with the `preserved` label. This tells the user "this data exists and is safe." When `includeRaw` is on, the same counts display as "will delete" with red icons.

The `Accounts` row is special: it only shows a count when both `includeRaw` is on AND a scoped filter (`--account-id` or `--source`) is applied. For unscoped clear, accounts are never deleted — the row shows 0 and `·` dim.

---

## Detail Panel

Adapts based on the selected data category and current phase.

### Processed Data Category (Preview)

```
▸ {category}  {count} items

  {description}
  Used by: {relatedCommand}

  Recovery: {recoveryText}
```

### Raw Data Category — Preserved (Preview)

```
▸ {category}  {count} items  preserved

  {description}
  Will be preserved for reprocessing.

  Toggle: Press 'r' to include raw data in deletion.
```

### Raw Data Category — Will Delete (Preview)

```
▸ {category}  {count} items

  ⚠ {description}
  Deleting raw data requires a full re-import (slow, rate-limited).

  Sources: {source1} ({count1}) · {source2} ({count2})
```

The `Sources:` line is only shown for `Raw data items` — it breaks down counts by exchange/blockchain origin.

### Detail Panel Elements

| Element           | Color                                    |
| ----------------- | ---------------------------------------- |
| Category name     | white/bold                               |
| Item count        | white (will-delete) or green (preserved) |
| `items`           | dim                                      |
| `preserved`       | green                                    |
| Description text  | white                                    |
| `Used by:` label  | dim                                      |
| Related command   | dim                                      |
| `Recovery:` label | dim                                      |
| Recovery text     | dim                                      |
| `Toggle:` label   | dim                                      |
| Toggle hint       | dim                                      |
| `⚠` warning       | yellow                                   |
| Warning text      | yellow                                   |
| `Sources:` label  | dim                                      |
| Source names      | cyan                                     |
| Source counts     | white                                    |
| Dot separator `·` | dim                                      |

---

## Category Descriptions

| Category          | Description                                                  | Used By                                  | Recovery                                    |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------- |
| Transactions      | Processed transaction records with movements, fees, metadata | `exitbook transactions view`             | Run `exitbook reprocess` to reprocess       |
| Transaction links | Transfer link matches between outflows and inflows           | `exitbook links view`                    | Run `exitbook links run` after reprocessing |
| Accounts          | Account records linking sources to your profile              | `exitbook accounts view`                 | Re-import to recreate accounts              |
| Import sessions   | Import run history and metadata                              | `exitbook accounts view --show-sessions` | Re-import to recreate sessions              |
| Raw data items    | Original imported data from exchanges and blockchains        | —                                        | Re-import from source (slow, rate-limited)  |

---

## Toggle Include-Raw (`r` key)

Pressing `r` during preview toggles raw data inclusion. The toggle is instant — both preview scenarios are pre-fetched during loading.

**Off → On:**

- Raw data rows change from `✓ preserved` (green) to `✗ will delete` (red)
- Accounts row shows actual count (if scoped filter active)
- Header total increases, `raw data preserved` → `⚠ raw data included`
- Detail panel updates if a raw data row is selected

**On → Off:**

- Reverse of above
- Raw data rows revert to `✓ preserved`
- Header total decreases

---

## Confirmation Flow

### Phase: Confirming

Press `d` in preview phase. The list and detail panel remain visible — only the controls bar changes.

**Controls bar changes to:**

```
d confirm deletion · any key cancel
```

When include-raw is active:

```
d confirm — ⚠ raw data will be permanently lost · any key cancel
```

| Element                               | Color       |
| ------------------------------------- | ----------- |
| `d` key hint                          | red/bold    |
| `confirm deletion`                    | red         |
| `⚠ raw data will be permanently lost` | yellow/bold |
| `any key cancel`                      | dim         |

### Cancel

Any key except `d` returns to preview phase. Navigation keys cancel confirmation AND perform their normal action (e.g., `q` cancels and quits, arrow keys cancel and navigate).

---

## Phase: Executing

After second `d` press:

- Header changes to: `Clear Data  Clearing...`
- Detail panel shows spinner: `⠋ Clearing data...`
- List rows unchanged from preview
- Navigation disabled
- Controls bar: empty (no actions available)

Execution is typically fast (<1 second). On completion, transitions to complete phase.

---

## Phase: Complete

```
Clear data — all accounts · 360 items · raw data: preserved

  ✓ Transactions                  312 (deleted)
  ✓ Transaction links              48 (deleted)
  · Accounts                        0
  ✓ Import sessions                 5
  ✓ Raw data items              1,204

────────────────────────────────────────────────────────────────────────────────
✓ Clear complete

Deleted: 312 transactions, 48 links

Press 'q' to exit

q exit
```

- List rows show actual deleted counts with `(deleted)` status in yellow
- Preserved rows show counts without status label (they weren't touched)
- Detail panel shows success message and summary
- Header remains unchanged from preview phase

### With Include-Raw

```
Clear data — all accounts · 1,572 items · raw data: included

  ✓ Transactions                  312 (deleted)
  ✓ Transaction links              48 (deleted)
  ✓ Accounts                        3 (deleted)
  ✓ Import sessions                 5 (deleted)
  ✓ Raw data items              1,204 (deleted)

────────────────────────────────────────────────────────────────────────────────
✓ Clear complete

Deleted: 312 transactions, 48 links, 3 accounts, 5 sessions, 1,204 raw items

Press 'q' to exit

q exit
```

### Complete Phase Styling

**Header:** Remains the same as preview phase (shows scope and raw status)

**Icons:** All deleted items show green `✓`, empty items show dim `·`

**Row Labels:**

- Deleted items: `(deleted)` in yellow
- Preserved items: no label (they weren't touched)
- Empty items: no label

**Detail Panel:**

```
✓ Clear complete

Deleted: {summary}

{recoveryHint}
```

| Element           | Color      |
| ----------------- | ---------- |
| `Clear complete.` | white/bold |
| Total deleted     | green      |
| `items deleted.`  | dim        |
| Recovery hint     | dim        |

Recovery hints by scenario:

| Scenario                  | Hint                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Without include-raw       | `Run \`exitbook reprocess\` to reprocess from preserved raw data.`                        |
| With include-raw          | `Re-import from sources to restore data:`<br>`  exitbook import --exchange <name> ...`    |
| With include-raw + source | `Re-import from {source} to restore data:`<br>`  exitbook import --exchange {source} ...` |

### Complete Phase Navigation

Navigation still works (browse rows, detail panel adapts). Only action is `q`/`Esc` to quit.

---

## Empty States

### No Data to Clear

```
Clear Data  0 items

  No data to clear.

  Import data first:
  exitbook import --exchange kucoin --csv-dir ./exports/kucoin

q/esc quit
```

### No Data Matching Filter

```
Clear Data (kraken)  0 items

  No data found for kraken.

q/esc quit
```

### Error Phase

If execution fails, transitions to error phase:

```
Clear Data  Error

  ✗  Transactions              312
  ✗  Transaction links          48
  ·  Accounts                    0
  ✓  Import sessions             5   preserved
  ✓  Raw data items          1,204   preserved

────────────────────────────────────────────────────────────────────────────────
⚠ Clear failed

{error.message}

q/esc exit
```

- Header shows "Error" status
- Detail panel shows error icon (⚠) + message
- Controls bar: `q/esc exit`
- Navigation disabled
- Press `q` or `Esc` to exit

---

## JSON Mode (`--json`)

Bypasses the TUI. Requires `--confirm` for execution. Without `--confirm`, outputs preview only.

### Preview (`--json` without `--confirm`)

```json
{
  "data": {
    "preview": {
      "accounts": 0,
      "transactions": 312,
      "links": 48,
      "sessions": 0,
      "rawData": 0
    }
  },
  "meta": {
    "includeRaw": false,
    "filters": {}
  }
}
```

### Execution (`--json --confirm`)

```json
{
  "data": {
    "deleted": {
      "accounts": 0,
      "transactions": 312,
      "links": 48,
      "sessions": 0,
      "rawData": 0
    }
  },
  "meta": {
    "includeRaw": false,
    "filters": { "source": "kraken" }
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color | Meaning                          |
| ---- | ----- | -------------------------------- |
| `✗`  | red   | Will delete                      |
| `✓`  | green | Preserved / successfully deleted |
| `·`  | dim   | Nothing to delete                |
| `▸`  | —     | Cursor (bold)                    |

**Content tier (what you read):**

| Element                     | Color    |
| --------------------------- | -------- |
| Category names              | white    |
| Item counts (to delete)     | white    |
| Item counts (preserved)     | green    |
| Total items in header (> 0) | red      |
| Total deleted in header     | green    |
| `deleted` label             | green    |
| `preserved` label           | green    |
| Source names                | cyan     |
| Source counts               | white    |
| Confirmation `d` key hint   | red/bold |
| Confirmation text           | red      |

**Context tier (recedes):**

| Element                                | Color |
| -------------------------------------- | ----- |
| Divider `─`                            | dim   |
| Dot separator `·`                      | dim   |
| `items to delete`, `items deleted.`    | dim   |
| `items`                                | dim   |
| Labels (`Used by:`, `Recovery:`, etc.) | dim   |
| Related commands                       | dim   |
| Recovery text                          | dim   |
| Toggle hint                            | dim   |
| `any key cancel`                       | dim   |
| Controls bar                           | dim   |

---

## State Model

```typescript
interface ClearViewState {
  // Phase
  phase: 'preview' | 'confirming' | 'executing' | 'complete' | 'error';

  // Scope (from CLI args)
  scope: {
    accountId?: number | undefined;
    source?: string | undefined;
    label: string; // "all accounts", "kraken", "#4 bitcoin"
  };

  // Previews — pre-fetched for both includeRaw scenarios
  previewWithRaw: DeletionPreview;
  previewWithoutRaw: DeletionPreview;

  // Toggle state
  includeRaw: boolean;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Result (after execution)
  result?: DeletionPreview | undefined;

  // Error (on execution failure)
  error?: Error | undefined;
}
```

### Derived Data

```typescript
/** Active preview based on current includeRaw state */
function activePreview(state: ClearViewState): DeletionPreview {
  return state.includeRaw ? state.previewWithRaw : state.previewWithoutRaw;
}

/** Total items to delete (excludes preserved) */
function totalToDelete(state: ClearViewState): number {
  const preview = activePreview(state);
  return (
    preview.transactions +
    preview.links +
    preview.accounts +
    (state.includeRaw ? preview.sessions + preview.rawData : 0)
  );
}

/** Build display rows from state */
interface ClearCategoryItem {
  key: string;
  label: string;
  count: number;
  group: 'processed' | 'raw';
  status: 'will-delete' | 'preserved' | 'empty';
}

function buildCategories(state: ClearViewState): ClearCategoryItem[] {
  const preview = activePreview(state);
  const rawPreview = state.previewWithRaw; // always use full counts for display

  return [
    // Processed data — always deleted when count > 0
    {
      key: 'transactions',
      label: 'Transactions',
      count: preview.transactions,
      group: 'processed',
      status: preview.transactions > 0 ? 'will-delete' : 'empty',
    },
    {
      key: 'links',
      label: 'Transaction links',
      count: preview.links,
      group: 'processed',
      status: preview.links > 0 ? 'will-delete' : 'empty',
    },

    // Raw data — preserved by default, use rawPreview for actual counts
    {
      key: 'accounts',
      label: 'Accounts',
      count: rawPreview.accounts,
      group: 'raw',
      status:
        state.includeRaw && rawPreview.accounts > 0 ? 'will-delete' : rawPreview.accounts > 0 ? 'preserved' : 'empty',
    },
    {
      key: 'sessions',
      label: 'Import sessions',
      count: rawPreview.sessions,
      group: 'raw',
      status:
        state.includeRaw && rawPreview.sessions > 0 ? 'will-delete' : rawPreview.sessions > 0 ? 'preserved' : 'empty',
    },
    {
      key: 'rawData',
      label: 'Raw data items',
      count: rawPreview.rawData,
      group: 'raw',
      status:
        state.includeRaw && rawPreview.rawData > 0 ? 'will-delete' : rawPreview.rawData > 0 ? 'preserved' : 'empty',
    },
  ];
}
```

### Actions

```typescript
type ClearViewAction =
  // Navigation
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Toggle
  | { type: 'TOGGLE_INCLUDE_RAW' }

  // Confirmation flow
  | { type: 'INITIATE_DELETE' }
  | { type: 'CONFIRM_DELETE' }
  | { type: 'CANCEL_CONFIRM' }

  // Execution result
  | { type: 'EXECUTION_COMPLETE'; result: DeletionPreview }
  | { type: 'EXECUTION_FAILED'; error: Error };
```

---

## Component Structure

```
ClearApp
├── Header (scope + total count + raw status)
├── CategoryList
│   └── CategoryRow (icon, label, count, status)
├── Divider
├── DetailPanel (adapts to phase + selected category)
│   ├── PreviewDetail (preview phase - category description + status)
│   ├── ConfirmingDetail (confirming phase - warning + instructions)
│   ├── ExecutingDetail (executing phase - spinner)
│   ├── CompleteDetail (complete phase - success summary)
│   └── ErrorDetail (error phase - error message)
└── ControlsBar (adapts to phase)
```

---

## Command Options

```
exitbook clear [options]

Options:
  --account-id <id>    Clear data for specific account ID
  --source <name>      Clear data for all accounts with this source name
  --include-raw        Also delete raw imported data (WARNING: requires re-import)
  --confirm            Skip TUI, execute immediately
  --json               Output JSON, bypass TUI
  -h, --help           Display help
```

---

## Implementation Notes

### Data Flow

1. Parse and validate CLI options at the boundary
2. Initialize database, create ClearService
3. Fetch both preview scenarios in parallel:
   - `previewDeletion({ ...params, includeRaw: false })`
   - `previewDeletion({ ...params, includeRaw: true })`
4. Build initial state from CLI flags (`includeRaw` from `--include-raw`)
5. Render Ink TUI with preview data
6. On `r` toggle: swap between pre-fetched previews (instant, no DB query)
7. On `d` + `d` confirm: call `clearService.execute()` with current params
8. Show result, close database on exit

### Pre-fetching Both Previews

To make the include-raw toggle instant, both preview scenarios are fetched upfront during loading. This doubles the initial DB count queries (~10 queries instead of ~5) but each is fast (simple `COUNT(*)`) and makes the interactive experience smooth.

### --confirm Flag

When `--confirm` is passed, skip the TUI entirely:

1. Fetch single preview (based on `--include-raw`)
2. Execute deletion immediately
3. Output result (text or JSON based on `--json` flag)
4. Exit

This preserves the existing scriptability of the clear command.

### Raw Data Count Nuance

The `previewDeletion` service only returns non-zero raw data counts when `includeRaw: true`. To show "preserved" counts when `includeRaw` is off, the TUI uses `previewWithRaw` for raw data row display values and `previewWithoutRaw` for the processed data counts. Processed counts are identical in both previews.

### Accounts Row Behavior

Accounts are only deleted when `includeRaw: true` AND a scoped filter (`--account-id` or `--source`) is applied. For unscoped clear-all, `previewWithRaw.accounts` is always 0 (the service preserves accounts for future imports). The accounts row reflects this — it shows 0 with `·` dim icon for unscoped clear regardless of the include-raw toggle.

### Terminal Size

- Category list: 9 rows maximum, always fits on screen
- No scrolling needed in practice
- Detail panel: ~5-6 lines
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — icons and text labels always accompany colors
- Double-press confirmation prevents accidental deletion
- `preserved`/`deleted` labels always shown as text
- Raw data warning shown as text, not just color/icon
