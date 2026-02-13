# Balance — Interactive TUI Spec

## Overview

`exitbook balance` verifies calculated balances against live data and shows results in an interactive TUI. It is a post-import data quality tool: fetch live balances from exchanges/blockchains, compare against calculated balances from imported transactions, and drill into mismatches.

Three entry modes, same TUI:

- **All accounts** (default): Verifies all verifiable accounts sequentially, showing progress. Lands on an account-level results browser with drill-down to asset detail.
- **Single account** (`--account-id N`): Verifies one account. Lands directly on an asset-level results browser with inline diagnostics.
- **Offline** (`--offline`): Skips live balance fetching entirely. Shows calculated balances from imported transactions with full diagnostics. No API calls, no credentials needed. Useful for inspecting transaction processing without verifying against live data.

`--json` bypasses the TUI in any mode.

---

## Shared Behavior

### Two-Panel Layout

List (top) and detail panel (bottom), separated by a full-width dim `─` divider. Same as prices-view, links-view, accounts-view, and transactions-view.

### Scrolling

When the list exceeds the visible height:

- Visible window scrolls to keep the selected row in view
- `▲` / `▼` dim indicators appear when more items exist above/below
- No explicit scroll bar

### Navigation

| Key               | Action           | When              |
| ----------------- | ---------------- | ----------------- |
| `↑` / `k`         | Move cursor up   | Always            |
| `↓` / `j`         | Move cursor down | Always            |
| `PgUp` / `Ctrl-U` | Page up          | Always            |
| `PgDn` / `Ctrl-D` | Page down        | Always            |
| `Home`            | Jump to first    | Always            |
| `End`             | Jump to last     | Always            |
| `Enter`           | Drill down       | Account list only |
| `Backspace`       | Back to accounts | Asset list only   |
| `q` / `Esc`       | Quit / Back      | See below         |

`Esc` behavior:

- Account list: quit
- Asset list (drilled-down from all-accounts): back to account list
- Asset list (single-account mode): quit

### Controls Bar

Bottom line, dim. Content adapts to current level.

### Error State

Transient error line appears below the detail panel, cleared on next navigation.

---

## All-Accounts Mode

### Verification Phase

The TUI renders immediately with all accounts listed. Verification runs sequentially — each account's row updates as it completes. The user can navigate and browse completed results while verification continues.

```
Balance Verification  6 accounts

  ✓  #1   kraken      exchange-api    5 assets   5 match                done
  ✓  #2   kucoin      exchange-api    3 assets   3 match                done
  ✗  #5   ethereum    blockchain      2 assets   1 match  1 mismatch   done
  ⏳ #4   bitcoin     blockchain      verifying...
     #3   coinbase    exchange-api    pending
  —  #6   kraken      exchange-csv    skipped (no credentials)

────────────────────────────────────────────────────────────────────────────────
⏳ Verifying bitcoin (account #4)...

↑↓/j/k navigate · q quit
```

#### Verification Order

1. Blockchain accounts (no credentials needed)
2. Exchange-api accounts (use stored credentials or env vars)
3. Exchange-csv accounts (use env vars for their exchange; skip if unavailable)

#### Account Row States During Verification

| State     | Icon   | Color  | Text                      |
| --------- | ------ | ------ | ------------------------- |
| Pending   | —      | dim    | `pending`                 |
| Verifying | `⏳`   | yellow | `verifying...`            |
| Done      | varies | varies | `{n} match  {n} mismatch` |
| Skipped   | `—`    | dim    | `skipped ({reason})`      |
| Error     | `✗`    | red    | `error: {message}`        |

Skip reasons: `no credentials`, `no provider`, `no transactions`.

#### Detail Panel During Verification

Shows context for the currently-verifying account:

```
⏳ Verifying bitcoin (account #4)...
```

For completed accounts (when selected):

```
▸ #5  ethereum  blockchain  2 assets · 1 mismatch

  ✓  ETH      calc 2.1500    live 2.1500    match
  ✗  USDC     calc 175.00    live 150.00    diff -25.00 (-14.3%)

  Press enter to drill down
```

### Results Phase

After all verifications complete, the header updates to the final summary and full interactive navigation is available.

```
Balance Verification  5 verified · 1 skipped · 4 match · 1 mismatch

  ✓  #1   kraken      exchange-api    5 assets   5 match
  ✓  #2   kucoin      exchange-api    3 assets   3 match
▸ ✗  #5   ethereum    blockchain      2 assets   1 match  1 mismatch
  ✓  #4   bitcoin     blockchain      1 asset    1 match
  ✓  #3   coinbase    exchange-api    4 assets   4 match
  —  #6   kraken      exchange-csv    skipped (no credentials)

────────────────────────────────────────────────────────────────────────────────
▸ #5  ethereum  blockchain  2 assets · 1 mismatch

  ✓  ETH      calc 2.1500    live 2.1500    match
  ✗  USDC     calc 175.00    live 150.00    diff -25.00 (-14.3%)

  Press enter to drill down

↑↓/j/k · ^U/^D page · Home/End · enter drill down · q/esc quit
```

### Header (All-Accounts)

During verification:

```
Balance Verification  {total} accounts
```

After completion:

```
Balance Verification  {verified} verified · {skipped} skipped · {matches} match · {mismatches} mismatch
```

- Title: white/bold
- Verified count: white
- `match` count: green
- `mismatch` count: red when > 0
- `skipped` count: dim (omitted when 0)
- Dot separators: dim

### Account List Columns

```
{cursor} {icon}  #{id}  {source}  {type}  {assetCount}  {matchCount}  {mismatchCount}  {status}
```

| Column   | Width | Alignment | Content                                      |
| -------- | ----- | --------- | -------------------------------------------- |
| Cursor   | 1     | —         | `▸` for selected, space otherwise            |
| Icon     | 1     | —         | Status icon                                  |
| ID       | 4     | right     | `#{id}` prefixed                             |
| Source   | 10    | left      | Exchange or blockchain name                  |
| Type     | 12    | left      | `blockchain`, `exchange-api`, `exchange-csv` |
| Assets   | 10    | right     | `{n} asset(s)`                               |
| Match    | 10    | right     | `{n} match`                                  |
| Mismatch | 12    | right     | `{n} mismatch` (omitted when 0)              |

### Account Status Icons (After Verification)

| Status       | Icon | Color  |
| ------------ | ---- | ------ |
| All match    | `✓`  | green  |
| Has warning  | `⚠`  | yellow |
| Has mismatch | `✗`  | red    |
| Skipped      | `—`  | dim    |
| Error        | `✗`  | red    |

### Account Row Colors

| Row State         | Color                     |
| ----------------- | ------------------------- |
| Selected (cursor) | white/bold for entire row |
| Completed (match) | normal white              |
| Mismatch          | normal white, icon red    |
| Skipped           | dim for entire row        |
| Error             | dim text, icon red        |

### Standard Row Color Scheme (Account List)

| Element        | Color |
| -------------- | ----- |
| Account ID     | white |
| Source name    | cyan  |
| Account type   | dim   |
| Asset count    | white |
| `asset(s)`     | dim   |
| Match count    | green |
| `match`        | dim   |
| Mismatch count | red   |
| `mismatch`     | red   |

### Detail Panel (Account List)

Shows the per-asset breakdown for the selected account.

```
▸ #{id}  {source}  {type}  {assetCount} assets · {mismatchCount} mismatch

  {icon}  {asset}    calc {calculated}    live {live}    {status}
  {icon}  {asset}    calc {calculated}    live {live}    diff {diff} ({pct}%)

  Press enter to drill down
```

For skipped accounts:

```
▸ #{id}  {source}  {type}  skipped

  {reason}
```

For error accounts:

```
▸ #{id}  {source}  {type}  error

  {errorMessage}
```

| Element                     | Color      |
| --------------------------- | ---------- |
| Account ID                  | white/bold |
| Source name                 | cyan       |
| Account type                | dim        |
| Asset count                 | white      |
| `assets` / `mismatch`       | dim        |
| Mismatch count              | red        |
| Asset symbol                | white      |
| `calc` label                | dim        |
| Calculated balance          | green      |
| `live` label                | dim        |
| Live balance value          | white      |
| `match`                     | green      |
| `diff` label                | dim        |
| Negative difference         | red        |
| Positive difference         | green      |
| Percentage diff             | dim        |
| `Press enter to drill down` | dim        |
| Skip/error reasons          | dim        |

### Sorting (Account List)

Default: by status (mismatches first, then warnings, then matches, then skipped), then by account ID ascending.

| Priority | Status   |
| -------- | -------- |
| 1        | error    |
| 2        | mismatch |
| 3        | warning  |
| 4        | match    |
| 5        | skipped  |

---

## Single-Account Mode / Drill-Down View

Activated by `--account-id N` (direct entry) or by pressing `Enter` on an account in all-accounts mode. Shows one account's per-asset balance comparisons with inline diagnostics.

### Loading (Single-Account Entry)

```
⠋ Verifying balance for ethereum (account #5)...
```

Brief spinner while verification runs, then asset list appears.

### Visual Example

```
Balance  ethereum #5  blockchain  2 assets · 1 match · 1 mismatch

  ✓  ETH      calc     2.1500    live     2.1500    match
▸ ✗  USDC     calc   175.0000    live   150.0000    diff -25.0000 (-14.3%)

────────────────────────────────────────────────────────────────────────────────
▸ USDC  calculated 175.0000 · live 150.0000 · diff -25.0000 (-14.3%)

  Transactions: 42 · 2023-06-12 to 2024-11-28
  Net from transactions: 175.0000 (in 500.0000 · out 325.0000 · fees 0.0000)

  Top Outflows
    -100.0000  2024-11-15  to 0x1234...5678  tx 0x7a3f...8b2e
     -75.0000  2024-10-28  to 0x9abc...def0  tx 0x3b1c...4d5e
     -50.0000  2024-09-15  to 0x5678...1234  tx 0xa2b3...c4d5

  Top Inflows
    +200.0000  2024-06-12  from 0xabcd...ef01  tx 0xf1e2...d3c4
    +150.0000  2024-08-20  from 0x2345...6789  tx 0xb5a6...7890

↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc quit
```

### Header (Asset List)

```
Balance  {source} #{id}  {type}  {assetCount} assets · {matches} match · {mismatches} mismatch
```

- Title: white/bold
- Source: cyan
- Account ID: white
- Type: dim
- `match` count: green
- `mismatch` count: red when > 0 (omitted when 0)
- Dot separators: dim

When all match:

```
Balance  kraken #1  exchange-api  5 assets · all match
```

### Asset List Columns

```
{cursor} {icon}  {asset}  calc {calculated}  live {live}  {status}
```

| Column     | Width    | Alignment | Content                           |
| ---------- | -------- | --------- | --------------------------------- |
| Cursor     | 1        | —         | `▸` for selected, space otherwise |
| Icon       | 1        | —         | Status icon                       |
| Asset      | 10       | left      | Asset symbol                      |
| `calc`     | 4        | —         | Label (dim)                       |
| Calculated | 14       | right     | Calculated balance                |
| `live`     | 4        | —         | Label (dim)                       |
| Live       | 14       | right     | Live balance                      |
| Status     | variable | left      | Status text or diff               |

### Asset Status Icons

| Status   | Icon | Color  |
| -------- | ---- | ------ |
| Match    | `✓`  | green  |
| Warning  | `⚠`  | yellow |
| Mismatch | `✗`  | red    |

### Asset Status Text

| Status   | Text                     | Color                  |
| -------- | ------------------------ | ---------------------- |
| Match    | `match`                  | green                  |
| Warning  | `diff {amount} ({pct}%)` | yellow amount, dim pct |
| Mismatch | `diff {amount} ({pct}%)` | red amount, dim pct    |

### Asset Row Colors

| Element     | Color                            |
| ----------- | -------------------------------- |
| Asset       | white                            |
| `calc`      | dim                              |
| Calculated  | green (positive), red (negative) |
| `live`      | dim                              |
| Live        | white                            |
| `match`     | green                            |
| Diff amount | red (negative), green (positive) |
| Diff pct    | dim                              |

### Detail Panel (Asset List) — Diagnostics

The detail panel shows transaction diagnostics for the selected asset. This replaces the `--explain` and `--debug-asset-id` flags — the information is always available inline.

#### Match Detail

```
▸ ETH  calculated 2.1500 · live 2.1500 · match

  Transactions: 156 · 2023-06-12 to 2024-11-28
  Net from transactions: 2.1500 (in 28.4500 · out 26.3000 · fees 0.0000)
```

#### Mismatch Detail

```
▸ USDC  calculated 175.0000 · live 150.0000 · diff -25.0000 (-14.3%)

  Transactions: 42 · 2023-06-12 to 2024-11-28
  Net from transactions: 175.0000 (in 500.0000 · out 325.0000 · fees 0.0000)
  Implied missing: -25.0000

  Top Outflows
    -100.0000  2024-11-15  to 0x1234...5678  tx 0x7a3f...8b2e
     -75.0000  2024-10-28  to 0x9abc...def0  tx 0x3b1c...4d5e
     -50.0000  2024-09-15  to 0x5678...1234  tx 0xa2b3...c4d5

  Top Inflows
    +200.0000  2024-06-12  from 0xabcd...ef01  tx 0xf1e2...d3c4
    +150.0000  2024-08-20  from 0x2345...6789  tx 0xb5a6...7890

  Top Fees
    -2.5000  2024-11-15  tx 0x7a3f...8b2e
```

#### Negative Calculated Balance Detail

```
▸ DOT  calculated -2.5000 · live 0.0000 · diff +2.5000

  Transactions: 8 · 2024-01-15 to 2024-06-20
  Net from transactions: -2.5000 (in 10.0000 · out 12.5000 · fees 0.0000)

  ⚠ Negative balance — likely missing inflow transactions

  Top Outflows
    -5.0000  2024-06-20  to 0xabcd...1234  tx 0xf1e2...d3c4
    -4.0000  2024-03-15  to 0x5678...9abc  tx 0xa2b3...c4d5
```

#### No Transactions for Asset

```
▸ SHIB  calculated 0.0000 · live 1,500,000.00 · diff +1,500,000.00

  No movements found in imported transactions.
  Live balance may be from missing import history or an airdrop.
```

### Detail Panel Elements (Asset Diagnostics)

| Element                         | Color                            |
| ------------------------------- | -------------------------------- |
| Asset symbol                    | white/bold                       |
| `calculated` label              | dim                              |
| Calculated value                | green (positive), red (negative) |
| `live` label                    | dim                              |
| Live value                      | white                            |
| `match`                         | green                            |
| `diff` label                    | dim                              |
| Difference value                | red (negative), green (positive) |
| Percentage diff                 | dim                              |
| `Transactions:` label           | dim                              |
| Transaction count               | white                            |
| Date range                      | dim                              |
| `Net from transactions:` label  | dim                              |
| Net value                       | white                            |
| `in` / `out` / `fees` labels    | dim                              |
| Inflow total                    | green                            |
| Outflow total                   | yellow                           |
| Fee total                       | yellow                           |
| `Implied missing:` label        | dim                              |
| Implied missing value           | red                              |
| Section labels (`Top Outflows`) | dim                              |
| Outflow amounts                 | yellow                           |
| Inflow amounts (`+`)            | green                            |
| Fee amounts                     | yellow                           |
| Timestamps in samples           | dim                              |
| Addresses (`to`, `from`)        | dim                              |
| Transaction hashes              | dim                              |
| Warning text                    | yellow                           |
| Explanatory text                | dim                              |

### Sorting (Asset List)

Default: by status (mismatches first), then by asset symbol alphabetically.

| Priority | Status   |
| -------- | -------- |
| 1        | mismatch |
| 2        | warning  |
| 3        | match    |

---

## Offline Mode

Activated by `--offline`. Calculates balances from imported transactions without fetching live data. No API calls, no credentials, no provider manager needed. Useful for inspecting transaction processing correctness, debugging calculated balances, or when API access is unavailable.

### All-Accounts Offline

Shows all accounts with their calculated balances — no verification phase, no progress animation. Loads instantly.

```
Balances (offline)  6 accounts

  #1   kraken      exchange-api    5 assets
  #2   kucoin      exchange-api    3 assets
▸ #5   ethereum    blockchain      2 assets
  #4   bitcoin     blockchain      1 asset
  #3   coinbase    exchange-api    4 assets
  #6   kraken      exchange-csv    2 assets

────────────────────────────────────────────────────────────────────────────────
▸ #5  ethereum  blockchain  2 assets

  ETH      2.1500
  USDC   175.0000

  Press enter to drill down

↑↓/j/k · ^U/^D page · Home/End · enter drill down · q/esc quit
```

### Header (Offline)

```
Balances (offline)  {accountCount} accounts
```

- Title: white/bold
- `(offline)`: dim
- Account count: white

When filtered:

```
Balances (offline · kraken)  2 accounts
```

### Account List Columns (Offline)

No verification columns — just identity and asset count:

```
{cursor} #{id}  {source}  {type}  {assetCount}
```

| Column | Width | Alignment | Content             |
| ------ | ----- | --------- | ------------------- |
| Cursor | 1     | —         | `▸` for selected    |
| ID     | 4     | right     | `#{id}` prefixed    |
| Source | 10    | left      | Exchange/blockchain |
| Type   | 12    | left      | Account type        |
| Assets | 10    | right     | `{n} asset(s)`      |

No status icons — there is no verification to report.

### Detail Panel (Offline Account List)

Shows calculated balance per asset for the selected account:

```
▸ #5  ethereum  blockchain  2 assets

  ETH      2.1500
  USDC   175.0000

  Press enter to drill down
```

| Element          | Color      |
| ---------------- | ---------- |
| Account ID       | white/bold |
| Source name      | cyan       |
| Account type     | dim        |
| Asset symbol     | white      |
| Positive balance | green      |
| Negative balance | red        |

### Single-Account Offline (`--account-id N --offline`)

Skips straight to the asset list with diagnostics. Same layout as the verification asset list, but with no `live` column.

```
Balance (offline)  ethereum #5  blockchain  2 assets

     ETH        2.1500
▸    USDC      175.0000

────────────────────────────────────────────────────────────────────────────────
▸ USDC  balance 175.0000

  Transactions: 42 · 2023-06-12 to 2024-11-28
  Net from transactions: 175.0000 (in 500.0000 · out 325.0000 · fees 0.0000)

  Top Outflows
    -100.0000  2024-11-15  to 0x1234...5678  tx 0x7a3f...8b2e
     -75.0000  2024-10-28  to 0x9abc...def0  tx 0x3b1c...4d5e
     -50.0000  2024-09-15  to 0x5678...1234  tx 0xa2b3...c4d5

  Top Inflows
    +200.0000  2024-06-12  from 0xabcd...ef01  tx 0xf1e2...d3c4
    +150.0000  2024-08-20  from 0x2345...6789  tx 0xb5a6...7890

↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

### Asset List Columns (Offline)

No `live` or `status` columns — just the calculated balance:

```
{cursor} {asset}  {balance}
```

| Column  | Width | Alignment | Content            |
| ------- | ----- | --------- | ------------------ |
| Cursor  | 1     | —         | `▸` for selected   |
| Asset   | 10    | left      | Asset symbol       |
| Balance | 14    | right     | Calculated balance |

No status icons.

### Detail Panel (Offline Asset List) — Diagnostics

Same diagnostic content as verification mode, but the summary line omits `live` and `diff`:

```
▸ USDC  balance 175.0000

  Transactions: 42 · 2023-06-12 to 2024-11-28
  Net from transactions: 175.0000 (in 500.0000 · out 325.0000 · fees 0.0000)

  Top Outflows
    ...

  Top Inflows
    ...

  Top Fees
    ...
```

For negative balances:

```
▸ DOT  balance -2.5000

  Transactions: 8 · 2024-01-15 to 2024-06-20
  Net from transactions: -2.5000 (in 10.0000 · out 12.5000 · fees 0.0000)

  ⚠ Negative balance — likely missing inflow transactions

  Top Outflows
    ...
```

### Sorting (Offline)

Account list: by account ID ascending.

Asset list: negative balances first, then by absolute balance descending (largest holdings first).

---

## Drill-Down Navigation

### Account List → Asset List

Press `Enter` on any completed account row. The view transitions to the asset list for that account.

- Skipped and error account rows do not respond to `Enter`
- The asset list header shows the account context

### Asset List → Account List

Press `Backspace` or `Esc` (in drilled-down mode only). Returns to account list, restoring the previous cursor position.

In single-account mode (entered via `--account-id`), there is no account list to return to — `Esc` and `q` quit.

### Controls Bar (Account List)

```
↑↓/j/k · ^U/^D page · Home/End · enter drill down · q/esc quit
```

### Controls Bar (Asset List — Drilled-Down)

```
↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back
```

### Controls Bar (Asset List — Single Account)

```
↑↓/j/k · ^U/^D page · Home/End · q/esc quit
```

---

## Credential Resolution (All-Accounts Mode)

For exchange accounts, live balance fetching requires API credentials. Resolution order:

1. **Stored credentials** — `Account.credentials` (exchange-api accounts store these on import)
2. **Environment variables** — `{EXCHANGE}_API_KEY`, `{EXCHANGE}_SECRET` (from `.env`)
3. **Skip** — if neither available, the account is skipped with reason `no credentials`

Blockchain accounts need no credentials — they use the configured provider manager.

Exchange-csv accounts have no stored credentials. They can only be verified if env vars are set for their exchange name.

---

## Filters

### Account Filter (`--account-id`)

Enters single-account mode — verifies and shows results for one account.

```bash
exitbook balance --account-id 5
exitbook balance --account-id 7 --api-key KEY --api-secret SECRET
```

### Offline Mode (`--offline`)

Skips live balance fetching. Shows calculated balances from transactions with full diagnostics. No API calls, no credentials, no provider manager.

```bash
exitbook balance --offline                    # All accounts, calculated only
exitbook balance --offline --account-id 5     # Single account, calculated only
exitbook balance --offline --json             # JSON output, no live data
```

Combines with `--account-id` for focused debugging of one account's transaction processing.

### API Credentials

Override credentials for exchange accounts:

```bash
exitbook balance --account-id 7 --api-key KEY --api-secret SECRET
exitbook balance --account-id 7 --api-key KEY --api-secret SECRET --api-passphrase PASS
```

Only valid with `--account-id` and without `--offline`. Applies to exchange-api and exchange-csv accounts.

---

## Empty States

### No Accounts

```
Balance Verification  0 accounts

  No accounts found.

  Import data to create accounts:
  exitbook import --exchange kraken --csv-dir ./exports/kraken

q quit
```

### All Accounts Skipped

```
Balance Verification  0 verified · 3 skipped

  —  #1   kraken      exchange-csv    skipped (no credentials)
  —  #2   coinbase    exchange-csv    skipped (no credentials)
  —  #3   kucoin      exchange-csv    skipped (no credentials)

────────────────────────────────────────────────────────────────────────────────
  All accounts skipped. Set exchange credentials in .env or use:
  exitbook balance --account-id 1 --api-key KEY --api-secret SECRET

q quit
```

### No Transactions for Account (Single-Account Mode)

```
Balance  ethereum #5  blockchain  0 assets

  No transactions found for this account.

  Import transactions first:
  exitbook import --blockchain ethereum --address 0x742d...bD38

q quit
```

---

## JSON Mode (`--json`)

Bypasses the TUI. Runs verification and outputs structured results.

### All Accounts

```json
{
  "data": {
    "accounts": [
      {
        "accountId": 1,
        "sourceName": "kraken",
        "accountType": "exchange-api",
        "status": "success",
        "summary": {
          "totalAssets": 5,
          "matches": 5,
          "warnings": 0,
          "mismatches": 0
        },
        "comparisons": [
          {
            "assetId": "exchange:kraken:BTC",
            "assetSymbol": "BTC",
            "calculatedBalance": "0.5000",
            "liveBalance": "0.5000",
            "difference": "0",
            "percentageDiff": 0,
            "status": "match"
          }
        ]
      },
      {
        "accountId": 6,
        "sourceName": "kraken",
        "accountType": "exchange-csv",
        "status": "skipped",
        "reason": "no credentials"
      }
    ]
  },
  "meta": {
    "totalAccounts": 6,
    "verified": 5,
    "skipped": 1,
    "matches": 4,
    "mismatches": 1,
    "timestamp": "2024-12-20T14:30:00Z"
  }
}
```

### Single Account (`--account-id`)

Same shape as the existing `BalanceCommandResult` — preserves backward compatibility for scripts:

```json
{
  "status": "warning",
  "balances": [
    {
      "assetId": "blockchain:ethereum:native",
      "currency": "ETH",
      "calculatedBalance": "2.1500",
      "liveBalance": "2.1500",
      "difference": "0",
      "percentageDiff": 0,
      "status": "match"
    },
    {
      "assetId": "blockchain:ethereum:0xa0b8...",
      "currency": "USDC",
      "calculatedBalance": "175.0000",
      "liveBalance": "150.0000",
      "difference": "-25.0000",
      "percentageDiff": -14.29,
      "status": "mismatch"
    }
  ],
  "summary": {
    "totalCurrencies": 2,
    "matches": 1,
    "warnings": 0,
    "mismatches": 1
  },
  "source": { "type": "blockchain", "name": "ethereum", "address": "0x742d..." },
  "account": { "id": 5, "type": "blockchain", "sourceName": "ethereum", "identifier": "0x742d..." },
  "meta": { "timestamp": "2024-12-20T14:30:00Z" }
}
```

### Offline (`--offline --json`)

No live balances — only calculated balances and diagnostics:

```json
{
  "data": {
    "accounts": [
      {
        "accountId": 5,
        "sourceName": "ethereum",
        "accountType": "blockchain",
        "assets": [
          {
            "assetId": "blockchain:ethereum:native",
            "assetSymbol": "ETH",
            "calculatedBalance": "2.1500",
            "diagnostics": {
              "txCount": 156,
              "dateRange": { "earliest": "2023-06-12", "latest": "2024-11-28" },
              "totals": { "inflows": "28.4500", "outflows": "26.3000", "fees": "0.0000", "net": "2.1500" }
            }
          }
        ]
      }
    ]
  },
  "meta": {
    "totalAccounts": 6,
    "mode": "offline",
    "filters": {}
  }
}
```

---

## Color Specification

### Three-Tier Hierarchy

Same conventions as all other TUI views.

**Signal tier (icons + cursor):**

| Icon | Color  | Meaning       |
| ---- | ------ | ------------- |
| `✓`  | green  | Match         |
| `⚠`  | yellow | Warning       |
| `✗`  | red    | Mismatch      |
| `⏳` | yellow | Verifying     |
| `—`  | dim    | Skipped       |
| `▸`  | —      | Cursor (bold) |

**Content tier (what you read):**

| Element                | Color  |
| ---------------------- | ------ |
| Asset symbols          | white  |
| Positive balances      | green  |
| Negative balances      | red    |
| Source names           | cyan   |
| Account IDs            | white  |
| Live balance values    | white  |
| Match counts           | green  |
| Mismatch counts        | red    |
| Inflow totals/amounts  | green  |
| Outflow totals/amounts | yellow |
| Fee totals/amounts     | yellow |
| Difference (positive)  | green  |
| Difference (negative)  | red    |
| Net value              | white  |

**Context tier (recedes):**

| Element                                              | Color |
| ---------------------------------------------------- | ----- |
| Account types (`blockchain`, `exchange-api`)         | dim   |
| Dot separator `·`                                    | dim   |
| Labels (`calc`, `live`, `diff`, `in`, `out`, `fees`) | dim   |
| Percentage diff                                      | dim   |
| `match`, `asset(s)`, `mismatch` labels (non-count)   | dim   |
| Section labels (`Top Outflows`, `Top Inflows`)       | dim   |
| Timestamps                                           | dim   |
| Addresses and transaction hashes                     | dim   |
| `Press enter to drill down`                          | dim   |
| Command/action hints                                 | dim   |
| Divider `─`                                          | dim   |
| Controls bar                                         | dim   |
| Scroll indicators                                    | dim   |
| `pending`, `skipped`, skip reasons                   | dim   |

---

## State Model

```typescript
/** Top-level: which view is active */
type BalanceState =
  | BalanceVerificationState // All-accounts: verification progress + account list
  | BalanceOfflineState // All-accounts offline: calculated balances only
  | BalanceAssetState; // Single-account or drilled-down: asset list

/** All-accounts mode (online verification) */
interface BalanceVerificationState {
  view: 'accounts';
  phase: 'verifying' | 'complete';
  offline: false;

  accounts: AccountVerificationItem[];
  summary: {
    verified: number;
    skipped: number;
    matches: number;
    mismatches: number;
  };

  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
}

/** All-accounts offline mode */
interface BalanceOfflineState {
  view: 'accounts';
  offline: true;

  accounts: AccountOfflineItem[];
  totalAccounts: number;

  selectedIndex: number;
  scrollOffset: number;

  // Filters
  sourceFilter?: string | undefined;
}

/** Per-account item in offline mode */
interface AccountOfflineItem {
  accountId: number;
  sourceName: string;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  assetCount: number;
  /** Calculated balances for detail panel + drill-down */
  assets: AssetOfflineItem[];
}

/** Per-asset item in offline mode */
interface AssetOfflineItem {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  isNegative: boolean;
  diagnostics: AssetDiagnostics;
}

/** Single-account mode / drill-down */
interface BalanceAssetState {
  view: 'assets';
  offline: boolean;

  // Account context
  accountId: number;
  sourceName: string;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';

  // Results — online mode uses AssetComparisonItem, offline uses AssetOfflineItem
  assets: AssetComparisonItem[] | AssetOfflineItem[];
  summary: {
    totalAssets: number;
    matches?: number | undefined; // undefined in offline mode
    warnings?: number | undefined; // undefined in offline mode
    mismatches?: number | undefined; // undefined in offline mode
  };

  selectedIndex: number;
  scrollOffset: number;

  // Drill-down context (undefined = entered via --account-id, not drill-down)
  parentAccountIndex?: number | undefined;

  error?: string | undefined;
}

/** Per-account result in all-accounts mode */
interface AccountVerificationItem {
  accountId: number;
  sourceName: string;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  status: 'pending' | 'verifying' | 'success' | 'warning' | 'failed' | 'skipped' | 'error';
  assetCount: number;
  matchCount: number;
  warningCount: number;
  mismatchCount: number;
  skipReason?: string | undefined;
  errorMessage?: string | undefined;
  /** Per-asset comparisons (populated after verification completes) */
  comparisons?: AssetComparisonItem[] | undefined;
}

/** Per-asset comparison in asset list */
interface AssetComparisonItem {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  liveBalance: string;
  difference: string;
  percentageDiff: number;
  status: 'match' | 'warning' | 'mismatch';

  /** Diagnostic data (precomputed during verification) */
  diagnostics: AssetDiagnostics;
}

/** Transaction diagnostics for one asset */
interface AssetDiagnostics {
  txCount: number;
  dateRange?: { earliest: string; latest: string } | undefined;
  totals: {
    inflows: string;
    outflows: string;
    fees: string;
    net: string;
  };
  impliedMissing?: string | undefined; // live - calculated, when mismatched
  topOutflows: DiagnosticSample[];
  topInflows: DiagnosticSample[];
  topFees: DiagnosticFeeSample[];
}

interface DiagnosticSample {
  amount: string;
  datetime: string;
  from?: string | undefined;
  to?: string | undefined;
  transactionHash?: string | undefined;
}

interface DiagnosticFeeSample {
  amount: string;
  datetime: string;
  transactionHash?: string | undefined;
}
```

### Actions

```typescript
type BalanceAction =
  // Navigation (both views)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Verification events (all-accounts mode)
  | { type: 'VERIFICATION_STARTED'; accountId: number }
  | { type: 'VERIFICATION_COMPLETED'; accountId: number; result: AccountVerificationItem }
  | { type: 'VERIFICATION_SKIPPED'; accountId: number; reason: string }
  | { type: 'VERIFICATION_ERROR'; accountId: number; error: string }
  | { type: 'ALL_VERIFICATIONS_COMPLETE' }

  // Drill-down
  | { type: 'DRILL_DOWN' } // Enter on account → asset list
  | { type: 'DRILL_UP' } // Backspace/Esc → back to account list

  // Error handling
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR'; error: string };
```

---

## Component Structure

```
BalanceApp
├── VerificationView (all-accounts mode)
│   ├── VerificationHeader
│   ├── AccountList
│   │   └── AccountRow
│   ├── Divider
│   ├── AccountDetailPanel (per-asset summary for selected account)
│   ├── ErrorLine
│   └── ControlsBar
│
└── AssetView (single-account mode / drill-down)
    ├── AssetHeader
    ├── AssetList
    │   └── AssetRow
    ├── Divider
    ├── AssetDiagnosticsPanel (diagnostics for selected asset)
    ├── ErrorLine
    └── ControlsBar
```

---

## Command Options

```
exitbook balance [options]

Options:
  --account-id <id>              Verify specific account (default: all accounts)
  --offline                      Skip live balance fetching; show calculated balances only
  --api-key <key>                API key for exchange (overrides .env)
  --api-secret <secret>          API secret for exchange (overrides .env)
  --api-passphrase <passphrase>  API passphrase for exchange (if required)
  --json                         Output JSON, bypass TUI
  -h, --help                     Display help
```

Notes:

- `--offline` works with or without `--account-id` — no API calls, no credentials needed
- `--api-key`, `--api-secret`, `--api-passphrase` only valid with `--account-id` and without `--offline`
- `--explain` and `--debug-asset-id` are removed — diagnostics are always available inline in the TUI
- `--debug-top` is removed — top 5 samples are always shown

---

## Implementation Notes

### Data Flow (All-Accounts Mode)

1. Parse and validate CLI options at the boundary
2. Initialize database and provider manager
3. Fetch all accounts via `AccountRepository`
4. Render TUI with all accounts in `pending` state
5. Verify each account sequentially:
   a. Resolve credentials (stored → env → skip)
   b. Call `BalanceService.verifyBalance()` — fetches live, calculates from transactions, compares
   c. Precompute `AssetDiagnostics` for each asset using `buildBalanceAssetDebug()`
   d. Dispatch `VERIFICATION_COMPLETED` (or `SKIPPED`/`ERROR`) to update the TUI
6. Dispatch `ALL_VERIFICATIONS_COMPLETE`
7. User browses results interactively
8. On quit: close database, destroy provider manager

### Data Flow (Single-Account Mode)

1. Parse and validate CLI options
2. Initialize database and provider manager
3. Fetch account by ID, resolve credentials
4. Show spinner while `BalanceService.verifyBalance()` runs
5. Precompute `AssetDiagnostics` for each asset
6. Render asset-level TUI with results
7. On quit: cleanup

### Data Flow (Offline Mode)

1. Parse and validate CLI options
2. Initialize database (no provider manager needed)
3. Fetch accounts (all, or one via `--account-id`)
4. For each account:
   a. Fetch transactions via `TransactionRepository.getTransactions({ accountIds })` (including child accounts)
   b. Run `calculateBalances()` to get per-asset calculated balances
   c. Run `buildBalanceAssetDebug()` for each asset to build diagnostics
5. Render TUI immediately (no verification phase, no progress animation)
6. On quit: close database

Offline mode never initializes the `BlockchainProviderManager` or exchange clients — no network I/O at all. This makes it fast and reliable for pure data inspection.

### Diagnostic Precomputation

During verification, after `BalanceService.verifyBalance()` returns, the controller fetches all transactions for the account (including child accounts for xpubs) and calls `buildBalanceAssetDebug()` for each asset in the comparison. This data is stored in `AssetComparisonItem.diagnostics` for instant access when the user navigates.

The `buildBalanceAssetDebug()` function already exists in `balance-debug.ts` — it computes totals, top inflows/outflows/fees from transactions.

### EventBus Integration

All-accounts mode uses the EventBus + EventRelay pattern (same as ingestion-monitor and prices-enrich). Verification events are emitted as each account completes, and the component updates via `useReducer`.

### Beacon Withdrawal Handling

For Ethereum blockchain accounts, beacon withdrawal status is checked from cursor metadata (same as current implementation). If beacon withdrawals are skipped due to missing provider support, this is noted in the account's detail panel as a warning.

### Terminal Size

- Account list: fills available height minus fixed chrome (~14 lines for header, divider, detail, controls)
- Asset list: same layout, detail panel varies by diagnostic content (top samples take ~15 lines)
- Minimum terminal width: 80 columns

### Accessibility

- Vim keys (`j`/`k`) alongside arrows
- No color-only information — icons and text labels always accompany colors
- Balance differences shown as numeric values with sign, not just color-coded
