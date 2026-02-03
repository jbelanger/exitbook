# Unified Dashboard Mockup

Single continuous view with no phase switching. Activity-focused design that shows what's happening in real-time.

## During Import/Processing (Live Updates)

```
EXITBOOK CLI  v2.1.0  •  Importing from Ethereum  •  Account #42  •  0xd8da...9d7e

1,234 imported  •  1,234 processed  •  1,340 API calls  •  00:08 elapsed

ACTIVE PROVIDERS                                    LATENCY   RATE      THROTTLES   REQUESTS
  alchemy       ● IDLE                              —         0 req/s   0           —
  etherscan     ● ACTIVE                            278ms     5 req/s   14          1,186 (200), 14 (429)
  moralis       ● ACTIVE                            1.2s      2 req/s   1           139 (200), 1 (429)
  routescan     ● IDLE                              950ms     0 req/s   0           45 (200)

RECENT ACTIVITY (15 earlier events)
  7:02:54 PM  ↻  Resumed normal tx with routescan
  7:02:55 PM  ℹ  Saved batch of 1000 transactions
  7:02:56 PM  ↻  Resumed token transfers with etherscan
  7:02:57 PM  ℹ  Batch #1701: 13 tokens cached, 2 fetched
  7:02:58 PM  ⚠  moralis: Rate limited

[CTRL+C] Abort
```

## When Complete (Frozen + Final Stats)

```
EXITBOOK CLI  v2.1.0  •  Importing from Ethereum  •  Account #42  •  0xd8da...9d7e

1,234 imported  •  1,234 processed  •  1,340 API calls  •  00:08 elapsed  ✓

ACTIVE PROVIDERS                                    LATENCY   RATE      THROTTLES   REQUESTS
  alchemy       ● IDLE                              —         0 req/s   0           —
  etherscan     ● IDLE                              278ms     0 req/s   14          1,186 (200), 14 (429)
  moralis       ● IDLE                              1.2s      0 req/s   1           139 (200), 1 (429)
  routescan     ● IDLE                              950ms     0 req/s   0           45 (200)

RECENT ACTIVITY (15 earlier events)
  7:02:54 PM  ↻  Resumed normal tx with routescan
  7:02:55 PM  ℹ  Saved batch of 1000 transactions
  7:02:56 PM  ↻  Resumed token transfers with etherscan
  7:02:57 PM  ℹ  Batch #1701: 13 tokens cached, 2 fetched
  7:02:58 PM  ⚠  moralis: Rate limited

Token Metadata:  92% cache hit rate (235 cached / 21 fetched)
Scams Filtered:  14 rejected (Silly, Cancy)
```

---

## Design Principles

### No Phase Switching

- Single continuous view throughout import → processing → completion
- Status line just shows "importing/processing" state
- All metrics update in place (no layout changes)
- No flicker from sections appearing/disappearing

### Activity-Focused

- **Status line** shows key counters: imported, processed, API calls, elapsed time
  - User sees "imported" increasing → import working
  - User sees "processed" increasing → processing working
  - User sees "API calls" increasing → metadata fetch happening
- **Provider table** shows who's working right now
  - During import: blockchain providers (etherscan, routescan) show ACTIVE
  - During processing: metadata providers (moralis, alchemy) light up
  - User sees provider activity → knows what's happening
- **Recent activity** shows event log (last 5 events, with overflow indicator)
  - "Resumed token transfers with etherscan" → knows which cursor type
  - "Batch #1701: 13 tokens cached, 2 fetched" → sees metadata activity
  - "moralis: Rate limited" → understands why things slowed down

### Completion = Freeze + Add Stats

- All counters frozen (no more updates)
- Add ✓ to status line
- Providers all show IDLE (work stopped)
- Add 2 lines of final stats below activity log:
  - Token metadata cache efficiency
  - Scam detection summary
- Activity log preserved (shows full run history)

---

## Data Sources

### Status Line

| Field            | Source                                       | Notes                              |
| ---------------- | -------------------------------------------- | ---------------------------------- |
| Account ID       | From import.started event (accountId)        | Database account ID                |
| Address/Exchange | From import context                          | 0xd8da...9d7e or "Kraken"          |
| Imported         | import.batch.totalImported                   | Cumulative                         |
| Processed        | process.batch.totalProcessed                 | Cumulative                         |
| API calls        | InstrumentationCollector.getMetrics().length | All HTTP requests                  |
| Elapsed          | import.started timestamp                     | mm:ss format                       |
| ✓ indicator      | Only on completion                           | Added when process.completed fires |

### Provider Table

| Column    | Source                                                     | Notes                                                                  |
| --------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Provider  | Active providers from instrumentation                      | Shows all providers (blockchain + metadata), **sorted alphabetically** |
| Status    | Provider events + request activity                         | Green ● ACTIVE if req/s > 0, Gray ● IDLE otherwise                     |
| Latency   | InstrumentationCollector (avg last 10 requests)            | Excludes 429 responses, shows `—` if no requests                       |
| Rate      | InstrumentationCollector (last 5s window)                  | Requests per second                                                    |
| Throttles | Count of provider.rate_limited events                      | Cumulative per provider                                                |
| Requests  | InstrumentationCollector grouped by provider + status code | Format: `1,186 (200), 14 (429)`, shows `—` if no requests              |

**REQUESTS column breakdown:**

- Group all requests by provider
- Group by HTTP status code
- Format: `{count} ({status}), {count} ({status}), ...`
- Show most common status codes first (200, 429, 500, etc.)

### Recent Activity

- Last 5 events from event log
- Shows overflow indicator: `(15 earlier events)` if more than 5 total
- Event types to show:
  - `provider.resume` → "↻ Resumed {streamType} with {provider}" (e.g., "Resumed token transfers with etherscan")
  - `import.batch` → "ℹ Saved batch of {n} transactions"
  - `metadata.batch.completed` → "ℹ Batch #{batchNumber}: {cacheHits} cached, {cacheMisses} fetched"
  - `provider.rate_limited` → "⚠ {provider}: Rate limited"
  - `provider.circuit_open` → "🔴 {provider}: Circuit breaker opened"
  - `provider.failover` → "⇄ Switched to {to}"

### Final Stats (Completion Only)

- **Token Metadata**: `{hitRate}% cache hit rate ({cacheHits} cached / {cacheMisses} fetched)`
  - Source: Accumulated from metadata.batch.completed events
- **Scams Filtered**: `{totalFound} rejected ({exampleSymbols})`
  - Source: Accumulated from scam.batch.summary events

---

## Implementation Notes

### Display Rules

- **Provider ordering**: Alphabetical by provider name (static, never re-sort during run)
- **Provider status indicator**: Use colored ● character:
  - **ACTIVE**: Green ● (pc.green('●')) for providers with req/s > 0 in last 5s
  - **IDLE**: Gray/dim ● (pc.dim('●')) for inactive providers
  - Text brightness: Dim entire row for IDLE providers, bright for ACTIVE
- **Activity overflow**: Show `({n} earlier events)` if total events > 5
- **Stream type display**: Use event.streamType directly (e.g., "normal tx", "token transfers", "internal tx")
- **Request breakdown**: Filter InstrumentationCollector by provider, group by status code
- **Final stats**: Only appear after process.completed event
- **Commands section**: Show `[CTRL+C] Abort` at bottom (during run only, remove on completion)
