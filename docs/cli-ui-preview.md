# CLI Import UI - Rich Terminal Experience

## Before vs After

### Old Output (plain text)

```
  Created import session #168
→ Starting import from injective (account 46)...
  Using provider cosmos-rest for getAddressTransactions
  ⚠ Provider failover: injective-explorer → cosmos-rest (provider failed)
  Resuming with injective-explorer from cursor 99878999
  normal: +0 new, 4 skipped (total: 0, cursor: 37)
✓ Import completed: 0 imported, 4 skipped (0.8s)

Done. 0 new transactions. 4 duplicates.

API Calls Summary:
┌────────────────────┬──────────────────────────────────────┬───────┬──────────────┐
│ Provider           │ Endpoint                             │ Calls │ Avg Response │
├────────────────────┼──────────────────────────────────────┼───────┼──────────────┤
│ cosmos-rest        │ /cosmos/tx/v1beta1/txs               │ 1     │ 45ms         │
│ injective-explorer │ /api/explorer/v1/accountTxs/{apiKey} │ 1     │ 697ms        │
└────────────────────┴──────────────────────────────────────┴───────┴──────────────┘
```

### New Output (rich terminal with colors, spinners, structure)

```
┌────────────────────────────────────────────────────────────┐
│ Importing from injective                                   │
└────────────────────────────────────────────────────────────┘

Account #46

SESSION
  Created import session #168

⠋ Fetching transactions... +0 new, 4 skipped (total: 0)

✓ Up to date (4 skipped, 0.8s)

BATCH SUMMARY
  ● New transactions:     0
  ● Duplicates skipped:   4
  ● Total in batch:       0
  ● Final cursor:         37

PROVIDER EVENTS
  Selected cosmos-rest for getAddressTransactions
  ⚠ Failover: injective-explorer → cosmos-rest (provider failed)
  Resumed with injective-explorer from cursor 99878999

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API CALLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2 requests · avg 371ms

cosmos-rest
  /cosmos/tx/v1beta1/txs
  └─ 1 call · 45ms

injective-explorer
  /api/explorer/v1/accountTxs/{apiKey}
  └─ 1 call · 697ms ⚠ slow

```

## With Actual Imports (new transactions)

```
┌────────────────────────────────────────────────────────────┐
│ Importing from bitcoin                                     │
└────────────────────────────────────────────────────────────┘

Account #12

SESSION
  Created import session #169

⠹ Fetching transactions... +143 new, 4 skipped (total: 143)

✓ Imported 143 transactions (4 skipped, 2.3s)

BATCH SUMMARY
  ● New transactions:     143
  ● Duplicates skipped:   4
  ● Total in batch:       143

⠙ Processing 143 transactions...

✓ Processed 143 transactions (1.2s)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API CALLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

5 requests · avg 234ms

blockchain.info
  /rawaddr/{address}
  └─ 3 calls · 189ms

mempool.space
  /api/address/{address}/txs
  └─ 2 calls · 302ms

```

## Features

### Visual Elements

- ✅ **Box headers** with source name
- ✅ **Live spinners** during async operations (ora)
- ✅ **Color coding** for status (picocolors):
  - Green: success
  - Yellow: warnings
  - Red: errors
  - Cyan: info
  - Magenta: processing
  - Dim: metadata
- ✅ **Section headers** for organization
- ✅ **Unicode symbols** for status (●, ✓, ✗, ⚠, ↻, ━)

### Information Hierarchy

1. **Header**: What's being imported
2. **Account info**: Which account
3. **Session**: Import session details
4. **Live progress**: Spinner with real-time counts
5. **Completion**: Success/failure with duration
6. **Batch summary**: Detailed statistics
7. **Provider events**: What happened behind the scenes
8. **API calls**: Performance breakdown

### Smart Condensing

- Hide session/account IDs in normal mode
- Show provider events only if interesting (failover, errors)
- Group API calls by provider
- Color-code slow responses (>500ms yellow, >1000ms red)
- Show warnings inline with spinners

### Developer Experience

- All info written to stderr (keeps stdout clean for JSON mode)
- Throttled batch updates (max 1 per 500ms)
- Provider events collected and shown at end
- No information loss - everything still logged
