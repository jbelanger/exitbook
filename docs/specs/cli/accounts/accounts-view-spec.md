# Accounts View — Interactive TUI Spec

## Overview

`exitbook accounts view` is a read-only TUI for browsing accounts and inspecting their import/verification status.

Single-mode design: a scrollable list of accounts with a detail panel showing the selected account's full metadata (identifier, provider, verification status, import sessions, child accounts for xpubs). Filters narrow the dataset via CLI flags.

`--json` bypasses the TUI.

---

## Two-Panel Layout

List (top) and detail panel (bottom), separated by a full-width dim `─` divider. Same shared behavior as prices-view, links-view, and transactions-view.

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

### Controls Bar

Bottom line, dim. Read-only — no action keys.

### Loading State

```
⠋ Loading accounts...
```

Brief spinner, then TUI appears.

---

## Visual Example

```
Accounts  6 total · 2 blockchain · 3 exchange-api · 1 exchange-csv

  ✓  #1   kraken      exchange-api   OhPz8e0p***   3 sessions   ✓ verified
  ✓  #2   kucoin      exchange-api   Kc9xR4mq***   2 sessions   ✓ verified
  ⊘  #3   coinbase    exchange-api   Cb2nL7wk***   1 session    ⊘ never checked
▸ ✓  #4   bitcoin     blockchain     xpub6CUG...   5 sessions   ✓ verified (3 derived)
  ✓  #5   ethereum    blockchain     0x742d...bD38  4 sessions   ✗ mismatch
  ⊘  #6   kraken      exchange-csv   /exports/kra   0 sessions   ⊘ never checked

────────────────────────────────────────────────────────────────────────────────
▸ #4  bitcoin  blockchain  xpub account (3 derived addresses)

  Identifier: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz
  Provider: mempool

  Balance Verified: 2024-12-15 08:30:00 ✓ match
  Created: 2024-06-12 14:23:00
  Sessions: 5

  Derived Addresses
    #7   bc1q84x...w9nk   2 sessions
    #8   bc1qxy2...s9me   2 sessions
    #9   bc1qar0...ejfh   1 session

↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

---

## Header

```
Accounts  {total} total · {blockchain} blockchain · {exchangeApi} exchange-api · {exchangeCsv} exchange-csv
```

- Title: white/bold
- Total count: white
- Type counts: white
- Type labels: dim
- Dot separators: dim
- Only show types with count > 0

When filtered:

```
Accounts (kraken)  2 total · 1 exchange-api · 1 exchange-csv
```

```
Accounts (blockchain)  2 total
```

---

## List Columns

```
{cursor} {icon}  #{id}  {source}  {type}  {identifier}  {sessions}  {verification}
```

| Column       | Width | Alignment | Content                                       |
| ------------ | ----- | --------- | --------------------------------------------- |
| Cursor       | 1     | —         | `▸` for selected, space otherwise             |
| Icon         | 1     | —         | Verification status icon                      |
| ID           | 4     | right     | `#{id}` prefixed                              |
| Source       | 10    | left      | Exchange or blockchain name, truncated        |
| Type         | 12    | left      | `blockchain`, `exchange-api`, `exchange-csv`  |
| Identifier   | 14    | left      | Masked/truncated identifier                   |
| Sessions     | 12    | right     | `{n} session(s)`                              |
| Verification | 18    | left      | `✓ verified`, `✗ mismatch`, `⊘ never checked` |

### Identifier Display

- **exchange-api**: first 8 chars + `***` (API key masking)
- **exchange-csv**: path truncated to 14 chars
- **blockchain**: truncated to `{first6}...{last4}` for addresses, `xpub6CUG...` for xpubs

### Verification Status Icons

| Status        | Icon | Color |
| ------------- | ---- | ----- |
| match         | `✓`  | green |
| mismatch      | `✗`  | red   |
| never-checked | `⊘`  | dim   |

### Verification Status Text

| Status        | Text              | Color |
| ------------- | ----------------- | ----- |
| match         | `✓ verified`      | green |
| mismatch      | `✗ mismatch`      | red   |
| never-checked | `⊘ never checked` | dim   |

### Row Colors

| Row State         | Color                     |
| ----------------- | ------------------------- |
| Selected (cursor) | white/bold for entire row |
| Normal            | standard color scheme     |

### Standard Row Color Scheme

| Element       | Color |
| ------------- | ----- |
| ID            | white |
| Source        | cyan  |
| Type          | dim   |
| Identifier    | dim   |
| Session count | white |
| `session(s)`  | dim   |

### Xpub Parent Rows

When an account is an xpub parent with derived addresses, append `({n} derived)` in dim after the verification status.

```
  ✓  #4   bitcoin     blockchain     xpub6CUG...   5 sessions   ✓ verified (3 derived)
```

### Child Account Rows

Child accounts (derived addresses) are NOT shown as separate rows in the main list — they appear only in the detail panel of their parent. This keeps the list clean and groups related accounts.

Exception: when `--account-id` targets a specific child account, it appears as a standalone row.

---

## Detail Panel

The detail panel adapts based on account type and whether it has child accounts.

### Exchange API Account

```
▸ #1  kraken  exchange-api

  Identifier: OhPz8e0p***
  Provider: —

  Balance Verified: 2024-12-20 14:30:00 ✓ match
  Created: 2024-01-15 09:00:00
  Sessions: 3
```

### Blockchain Account (Simple Address)

```
▸ #5  ethereum  blockchain

  Identifier: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38
  Provider: alchemy

  Balance Verified: 2024-12-18 11:00:00 ✗ mismatch
  Created: 2024-03-22 16:45:00
  Sessions: 4
```

### Blockchain Account (Xpub Parent)

```
▸ #4  bitcoin  blockchain  xpub account (3 derived addresses)

  Identifier: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz
  Provider: mempool

  Balance Verified: 2024-12-15 08:30:00 ✓ match
  Created: 2024-06-12 14:23:00
  Sessions: 5

  Derived Addresses
    #7   bc1q84x...w9nk   2 sessions
    #8   bc1qxy2...s9me   2 sessions
    #9   bc1qar0...ejfh   1 session
```

### Exchange CSV Account

```
▸ #6  kraken  exchange-csv

  Identifier: /exports/kraken
  Provider: —

  Balance Verified: — ⊘ never checked
  Created: 2024-11-01 10:00:00
  Sessions: 0
```

### Detail Panel Elements

| Element                      | Color      |
| ---------------------------- | ---------- |
| Account ID                   | white/bold |
| Source name                  | cyan       |
| Account type                 | dim        |
| `xpub account ({n} derived)` | dim        |
| `Identifier:` label          | dim        |
| Identifier value             | white      |
| `Provider:` label            | dim        |
| Provider name                | cyan       |
| `—` (no provider)            | dim        |
| `Balance Verified:` label    | dim        |
| Verification timestamp       | dim        |
| `✓ match`                    | green      |
| `✗ mismatch`                 | red        |
| `⊘ never checked`            | dim        |
| `Created:` label             | dim        |
| Created timestamp            | dim        |
| `Sessions:` label            | dim        |
| Session count                | white      |
| `Derived Addresses` label    | white/bold |
| Child account ID             | white      |
| Child identifier             | dim        |
| Child session count          | white      |

### Identifier Display in Detail Panel

Detail panel shows the **full** identifier (not truncated), except:

- **exchange-api**: still masked (`OhPz8e0p***`) for security
- Long xpubs: shown in full (they wrap naturally)

### Session Detail (--show-sessions)

When `--show-sessions` is passed, sessions expand below the session count:

```
▸ #1  kraken  exchange-api

  Identifier: OhPz8e0p***
  Provider: —

  Balance Verified: 2024-12-20 14:30:00 ✓ match
  Created: 2024-01-15 09:00:00
  Sessions: 3

  Import History
    ✓  #12  completed  2024-12-20 14:00 → 2024-12-20 14:30
    ✓  #8   completed  2024-11-15 10:00 → 2024-11-15 10:15
    ✗  #3   failed     2024-10-01 09:00 → 2024-10-01 09:02
```

### Session Status Icons

| Status    | Icon | Color  |
| --------- | ---- | ------ |
| completed | `✓`  | green  |
| failed    | `✗`  | red    |
| started   | `⏳` | yellow |
| cancelled | `⊘`  | dim    |

### Session Line Format

```
{icon}  #{sessionId}  {status}  {startedAt} → {completedAt}
```

- Session ID: white
- Status: matches icon color
- Timestamps: dim
- Arrow `→`: dim
- If no `completedAt`: show `→ —`

---

## Sorting

Default: by account ID ascending.

---

## Filters

### Source Filter (`--source`)

```bash
exitbook accounts view --source kraken     # Only Kraken accounts
exitbook accounts view --source bitcoin    # Only Bitcoin accounts
```

### Type Filter (`--type`)

```bash
exitbook accounts view --type blockchain     # Only blockchain accounts
exitbook accounts view --type exchange-api   # Only exchange API accounts
exitbook accounts view --type exchange-csv   # Only exchange CSV accounts
```

### Account ID (`--account-id`)

```bash
exitbook accounts view --account-id 4       # Specific account
```

### Show Sessions (`--show-sessions`)

```bash
exitbook accounts view --show-sessions      # Include import session history
```

---

## Empty States

### No Accounts

```
Accounts  0 total

  No accounts found.

  Import data to create accounts:
  exitbook import --exchange kucoin --csv-dir ./exports/kucoin

q quit
```

### No Accounts Matching Filter

```
Accounts (kraken)  0 total

  No accounts found for kraken.

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Returns structured account data.

```json
{
  "data": {
    "accounts": [
      {
        "id": 1,
        "accountType": "exchange-api",
        "sourceName": "kraken",
        "identifier": "OhPz8e0p***",
        "providerName": null,
        "lastBalanceCheckAt": "2024-12-20T14:30:00Z",
        "verificationStatus": "match",
        "sessionCount": 3,
        "childAccounts": null,
        "createdAt": "2024-01-15T09:00:00Z"
      },
      {
        "id": 4,
        "accountType": "blockchain",
        "sourceName": "bitcoin",
        "identifier": "xpub6CUG...",
        "providerName": "mempool",
        "lastBalanceCheckAt": "2024-12-15T08:30:00Z",
        "verificationStatus": "match",
        "sessionCount": 5,
        "childAccounts": [
          {
            "id": 7,
            "accountType": "blockchain",
            "sourceName": "bitcoin",
            "identifier": "bc1q84x...w9nk",
            "providerName": null,
            "lastBalanceCheckAt": null,
            "verificationStatus": "never-checked",
            "sessionCount": 2,
            "childAccounts": null,
            "createdAt": "2024-06-12T14:23:00Z"
          }
        ],
        "createdAt": "2024-06-12T14:23:00Z"
      }
    ],
    "sessions": {
      "1": [
        {
          "id": 12,
          "status": "completed",
          "startedAt": "2024-12-20T14:00:00Z",
          "completedAt": "2024-12-20T14:30:00Z"
        }
      ]
    }
  },
  "meta": {
    "total": 6,
    "filters": {}
  }
}
```

`sessions` key only present when `--show-sessions` is passed.

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning                    |
| ---- | ------ | -------------------------- |
| `✓`  | green  | Verified / session success |
| `✗`  | red    | Mismatch / session failed  |
| `⊘`  | dim    | Never checked / cancelled  |
| `⏳` | yellow | Session in progress        |
| `▸`  | —      | Cursor (bold)              |

**Content tier (what you read):**

| Element        | Color |
| -------------- | ----- |
| Account IDs    | white |
| Source names   | cyan  |
| Provider names | cyan  |
| Session counts | white |
| Session IDs    | white |

**Context tier (recedes):**

| Element                                   | Color |
| ----------------------------------------- | ----- |
| Account types                             | dim   |
| Identifiers (list rows)                   | dim   |
| Timestamps                                | dim   |
| Divider `─`                               | dim   |
| Dot separator `·`                         | dim   |
| Labels (`Identifier:`, `Provider:`, etc.) | dim   |
| `session(s)` label                        | dim   |
| Arrow `→` in sessions                     | dim   |
| `—` (no provider / no timestamp)          | dim   |
| Controls bar                              | dim   |
| Scroll indicators                         | dim   |

---

## State Model

```typescript
interface AccountsViewState {
  // Data
  accounts: AccountViewItem[];
  typeCounts: {
    blockchain: number;
    exchangeApi: number;
    exchangeCsv: number;
  };
  totalCount: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters (applied from CLI args, read-only in TUI)
  sourceFilter?: string | undefined;
  typeFilter?: string | undefined;
  showSessions: boolean;
}

/** Per-account display item */
interface AccountViewItem {
  id: number;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  sourceName: string;
  identifier: string; // masked/truncated for display
  fullIdentifier: string; // full value for detail panel (still masked for exchange-api)
  providerName: string | null;

  // Verification
  lastBalanceCheckAt: string | null;
  verificationStatus: 'match' | 'mismatch' | 'never-checked';

  // Sessions
  sessionCount: number;
  sessions?: SessionViewItem[] | undefined; // only when --show-sessions

  // Hierarchy
  childAccounts?: ChildAccountViewItem[] | undefined;

  createdAt: string;
}

/** Child account (derived address) for display in detail panel */
interface ChildAccountViewItem {
  id: number;
  identifier: string; // truncated address
  sessionCount: number;
}

/** Session display item */
interface SessionViewItem {
  id: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
}
```

### Actions

```typescript
type AccountsViewAction =
  // Navigation
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number };
```

Read-only view — no mutation actions.

---

## Component Structure

```
AccountsViewApp
├── Header (total + type counts + filter labels)
├── AccountList
│   └── AccountRow
├── Divider
├── AccountDetailPanel
│   ├── IdentifierSection
│   ├── VerificationSection
│   ├── DerivedAddressesSection (xpub parents only)
│   └── SessionHistorySection (--show-sessions only)
└── ControlsBar
```

---

## Command Options

```
exitbook accounts view [options]

Options:
  --account-id <number>    View specific account by ID
  --source <name>          Filter by exchange or blockchain name
  --type <type>            Filter by account type (blockchain, exchange-api, exchange-csv)
  --show-sessions          Include import session history in detail panel
  --json                   Output JSON, bypass TUI
  -h, --help               Display help
```

---

## Implementation Notes

### Data Flow

1. Parse and validate CLI options at the boundary
2. Initialize database, fetch accounts via `AccountService.viewAccounts(params)`
3. Transform `FormattedAccount[]` into `AccountViewItem[]` (mask identifiers, truncate, resolve hierarchy)
4. Compute type counts
5. Render Ink TUI with dataset in memory
6. Close database (read-only, no open connection needed during browsing)

### Identifier Masking

Uses existing `maskIdentifier()` from `account-service-utils.ts`:

- `exchange-api`: first 8 chars + `***`
- `blockchain` / `exchange-csv`: full identifier

List rows further truncate for column width. Detail panel shows the full masked value.

### Xpub Hierarchy

- Parent xpub accounts show aggregated session counts (own + children)
- Child accounts appear only in the parent's detail panel under "Derived Addresses"
- When `--account-id` targets a child account, it shows standalone (existing service behavior)

### Terminal Size

- List panel: fills available height minus fixed chrome (header ~3, divider 1, detail panel ~8, controls ~2, scroll indicators ~2 = ~16 lines)
- Xpub detail panels are taller (derived addresses add ~4–8 lines)
- `--show-sessions` adds ~4–6 lines to the detail panel
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — icons and text labels always accompany colors
- Verification status always shown as text + icon, not just color-coded
