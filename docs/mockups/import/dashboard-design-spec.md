# Dashboard - UX/Visual Design Specification

## Design Philosophy

**Operation tree** - Live status of what's happening now + what completed

### Key Features

- **No timestamps** - Focus on status and duration, not when
- **Hierarchical** - Tree structure shows parent/child operations
- **Live updates** - Lines update in place, not append
- **Status-first** - Icons show state at a glance (✓/⠋/⚠)

---

## Complete Visual Examples

### Example 1: Fresh Import Start

**Streams appear only when active (when they publish events):**

```
✓ 4 providers ready (91ms)
✓ Account #42
⠋ Import · 200ms
  └─ Normal: batch 1 · 200ms
     └─ 0 imported · etherscan 3.1/4 req/s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 1 · etherscan: 1
```

---

### Example 2: Multi-Stream In Progress

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
⠋ Import · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · etherscan 3.2/4 req/s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 47 · etherscan: 45, alchemy: 2
```

---

### Example 3: Rate Limit Wait

**During wait (replaces req/s temporarily):**

```
⠋ Import · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ⏸ waiting 187ms (rate limit)
```

**After wait completes (req/s returns):**

```
⠋ Import · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · etherscan 3.2/4 req/s
```

---

### Example 4: Provider Failover

**For 3 seconds (replaces req/s):**

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
⠋ Import · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ↻ switched to alchemy (etherscan rate limited)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 47 · etherscan: 45, alchemy: 2
```

**After 3 seconds (normal req/s display):**

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
⠋ Import · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · alchemy 2.1/4 req/s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 47 · etherscan: 45, alchemy: 2
```

---

### Example 5: Stream Failure

**Expanded with details (Option A):**

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
⠋ Import · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: batch 12 · 2m 14s
  │  └─ 3,891 imported · etherscan 3.2/4 req/s
  └─ Beacon: ⚠ Failed (800ms)
     └─ Rate limit exceeded - try setting ETHERSCAN_API_KEY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 48 · etherscan: 48
```

---

### Example 6: Import Complete → Processing

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
✓ Import (3m 47s)
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: 3,891 new (3m 44s)
  └─ Beacon: ⚠ Failed (800ms)
⠋ Processing · 500ms
  ├─ 847 / 3,891 raw transactions
  ├─ Token metadata: 745 cached, 34 fetched · etherscan 3.1/4 req/s
  └─ ⚠ 2 scam tokens (SHIB, PEPE)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 47 · etherscan: 45, alchemy: 2
```

---

### Example 7: Final Completion

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
✓ Import (3m 47s)
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: 3,891 new (3m 44s)
  └─ Beacon: ⚠ Failed (800ms)
✓ Processing (1m 23s)
  ├─ 3,891 raw → 3,245 transactions
  ├─ Token metadata: 2,847 cached, 156 fetched (95% cached)
  └─ ⚠ 12 scam tokens (SHIB, PEPE, RUG)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 47 total
  ├─ etherscan: 45 calls
  │  ├─ OK: 31 (200)
  │  ├─ Rate Limited: 12 (429)
  │  ├─ Retries: 10
  │  └─ Error: 2 (503)
  ├─ alchemy: 2 calls
  │  └─ OK: 2 (200)
  └─ moralis: 0 calls

⚠ Completed with 1 warning (5m 11s total)
   Beacon withdrawals unavailable - balance may be incomplete
```

**✓ Answered:**

1. Warning/error section at **bottom**
2. Expanded API stats with **OK/Rate-Limited/Error breakdown with HTTP codes**
3. Token metadata **integrated under processing steps**

---

## API Call Monitoring Details

### During Import (Live - 250ms refresh)

**Show live stats with retries/throttles/failures:**

```
API Calls: 47 · etherscan: 45 (12 retries, 10 rate-limited, 2 failed), alchemy: 2
```

### After Completion (Detailed)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 47 total
  ├─ etherscan: 45 calls
  │  ├─ OK: 43 (200)
  │  ├─ Rate Limited: 10 (429)
  │  ├─ Retries: 12
  │  └─ Error: 2 (503)
  ├─ alchemy: 2 calls
  │  └─ OK: 2 (200)
  └─ moralis: 0 calls
```

**✓ Answered:**

1. Show throttles/failures **live**
2. Update every **250ms** for performance
3. Show **both HTTP codes and counts**
4. Show **retries separately** from failures

---

## Edge Cases

### Empty Import (No Transactions)

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
✓ Import (800ms)
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: 0 new (200ms)
  └─ Beacon: 0 new (100ms)
✓ Processing (100ms)
  └─ No transactions to process

✓ Completed (900ms total)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: 4 · etherscan: 4
```

---

### CSV Import (No API Calls)

```
✓ Import from CSV (200ms)
  └─ Trades: 142 new
✓ Processing (400ms)
  └─ 142 transactions enriched

✓ Completed (600ms total)
```

**✓ Answered:**

1. **No API section** for CSV imports
2. **Simpler structure** - no providers/streams shown

---

### Multi-Batch Progress

**Format: Simple batch counter + cumulative items**

```
⠋ Token Transfers: batch 12 · 2m 14s
  └─ 3,891 imported · etherscan 3.2/4 req/s
```

**✓ Answered:**

1. Use **batches** (events already exist)
2. Total batches **never known ahead of time**
3. Show **cumulative items** (increases "imported" count)

---

## Spacing & Layout Rules

### Tree Characters

```
├─  for middle children
└─  for last child
│   for continuation
   for sub-details (3 spaces indent)
```

### Status Icons

```
✓  Complete (success)
⠋  In progress (spinner)
⚠  Warning (completed with issues)
↻  Switched/Changed
⏸  Paused/Waiting
```

### Time Format

- Under 1 second: `123ms` (millisecond precision for very fast imports)
- Under 1 minute: `12.3s`
- Over 1 minute: `2m 15s`
- Final total: `5m 11s total`

**Decision:** Use decimal seconds (12.3s) for 1s–59.9s, ms for <1s.

---

## Information Density

### Per-Stream Info Priority

**Essential (always show):**

- Stream name
- Status icon
- Record count
- Duration

**Important (show when active):**

- Batch number
- Provider name
- Request rate

**Nice-to-have (show when relevant):**

- Throttle count
- Wait time
- Failover message

**Decision:** Priority confirmed.

---

## Answered Questions Summary

✓ **Final summary placement** - Bottom
✓ **API stats expansion** - Yes, show OK/Rate-Limited/Error breakdown with HTTP codes
✓ **Token metadata** - Processing sub-line with provider/rate live, hit rate at completion
✓ **Live API monitoring** - Yes, update every 250ms
✓ **API breakdown format** - Both HTTP codes and counts
✓ **Retry tracking** - Yes, separate from failures
✓ **CSV imports** - No API section, simpler structure
✓ **Empty streams** - Say "No new transactions" when resuming
✓ **Resume tracking** - "x new" suffices for completed streams
✓ **API session distinction** - Just current session
✓ **Page display** - Use **batches** instead (events already exist)
✓ **Items display** - Cumulative (increases "imported")
✓ **Information priority** - Confirmed correct

## Final Decisions Summary

✓ **Streams** - Appear only when active
✓ **Empty streams** - Show "0 new"
✓ **Completed streams** - Keep visible, don't collapse
✓ **Page display** - Use **batches** instead (events already exist)
✓ **Rate limit display** - Replace req/s temporarily (Option C - no flicker)
✓ **Failover display** - Replace req/s temporarily, show 3 seconds
✓ **Failure display** - Expanded with details (Option A)
✓ **Processing phase** - Keep import streams visible; sub-lines: raw progress, token metadata (provider/rate live), scam tokens
✓ **API calls** - Keep visible during processing
✓ **Time precision** - Decimals (12.3s)
✓ **Account status** - Show account #, indicate if resuming
✓ **Resume cursor** - Don't show (future improvement)

---

## Final Visual Examples

### Rate Limit (no flicker)

```
⠋ Import · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ⏸ waiting 187ms (rate limit)
```

After wait completes:

```
⠋ Import · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · etherscan 3.2/4 req/s
```

### Failover (no flicker)

```
⠋ Import · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ↻ switched to alchemy (3s)
```

After 3 seconds:

```
⠋ Import · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · alchemy 2.1/4 req/s
```

### Account Status

**New account:**

```
✓ 4 providers ready (91ms)
✓ Account #42
⠋ Import · 200ms
  └─ Normal: batch 1 · 200ms
```

**Resuming account:**

```
✓ 4 providers ready (91ms)
✓ Account #42 (resuming from previous import)
⠋ Import · 200ms
  ├─ Normal: 0 new (300ms)
  └─ Token Transfers: batch 1 · 200ms
     └─ 127 imported · etherscan 3.2/4 req/s
```

---

---

## Developer Implementation Guide

### Component States & Transitions

#### Operation Status Icons

```typescript
type OperationStatus = 'active' | 'completed' | 'warning' | 'failed';

const STATUS_ICONS = {
  active: '⠋', // Spinner
  completed: '✓', // Check
  warning: '⚠', // Warning triangle
  failed: '⚠', // Warning (all failures are non-fatal)
} as const;
```

**Rule:** Use `⚠` for failures. All failures are warnings (non-fatal).

#### Stream Display Rules

**When to show a stream:**

1. Stream appears when first event arrives (e.g., `import.batch` or stream starts)
2. Stream stays visible until import completes

**Stream line format:**

```
├─ {streamName}: {status} ({duration})
└─ {streamName}: {status} ({duration})  ← last child uses └─
```

**Status text:**

- Active: `batch {batchNumber} · {duration}`
- Completed with items: `{count} new ({duration})`
- Completed empty: `0 new ({duration})`
- Failed: `⚠ Failed ({duration})`

**Active stream sub-line (only for active streams):**

```
   └─ {imported} imported · {providerInfo}
```

**Provider info format:**

- Normal: `{providerName} {currentRate}/{maxRate} req/s`
- Rate limited: `⏸ waiting {remainingTime} (rate limit)`
- Failover (3 seconds): `↻ switched to {newProvider} ({oldProvider} {reason})`

#### Import Phase Structure

```
⠋ Import · {duration}
  ├─ {stream1}: {status}
  ├─ {stream2}: {status}
  └─ {streamN}: {status}
     └─ {subline if active}
```

**Rules:**

1. Import shows spinner `⠋` while any stream is active
2. Import shows checkmark `✓` when all streams complete
3. Duration updates live every 250ms
4. Streams use `├─` except last stream uses `└─`
5. Sub-line uses 3-space indent + `└─`

#### Processing Phase Structure

**Active (blockchain):**

```
⠋ Processing · {duration}
  ├─ {processed} / {totalRaw} raw transactions
  ├─ Token metadata: {cached} cached, {fetched} fetched · {provider} {currentRate}/{maxRate} req/s
  └─ ⚠ {scamCount} scam tokens ({examples})
```

**Completed (blockchain):**

```
✓ Processing ({duration})
  ├─ {totalRaw} raw → {totalTransactions} transactions
  ├─ Token metadata: {cached} cached, {fetched} fetched ({hitRate}% cached)
  └─ ⚠ {scamCount} scam tokens ({examples})
```

**Sub-line rules:**

- **Progress:** `{processed} / {totalRaw} raw transactions` while active → `{totalRaw} raw → {totalTransactions} transactions` on completion. `totalRaw` from `process.started`. Processed accumulates from `process.batch.completed.batchSize`. Final transaction count from `process.completed.totalProcessed`.
- **Token metadata:** Provider + rate shown while fetching (same transient message patterns as import). Omitted entirely when all cached. On completion, provider/rate replaced by `({hitRate}% cached)`.
- **Scam tokens:** Only appears when scams found. Examples = first 3 unique symbols across batches.
- **CSV imports:** Single line only — `{count} transactions enriched`. No metadata or scam lines.

#### Time Formatting

```typescript
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
```

**Examples:**

- 187ms → `187ms`
- 1234ms → `1.2s`
- 12345ms → `12.3s`
- 135000ms → `2m 15s`

#### Rate Formatting

```typescript
function formatRate(currentRate: number, maxRate: number): string {
  return `${currentRate.toFixed(1)}/${maxRate} req/s`;
}
```

**Examples:**

- 3.2/4 req/s
- 1.0/4 req/s
- 0.5/2 req/s

### API Call Footer

#### During Import (Live - Update every 250ms)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: {total} · {provider1}: {count1} ({retries} retries, {rateLimited} rate-limited, {failed} failed), {provider2}: {count2}
```

**Rules:**

1. Always show total first
2. Show providers in alphabetical order
3. Only show retries/rate-limited/failed if > 0
4. If all zero, just show count: `provider: {count}`
5. If count is 0, show: `provider: 0`
6. If total is 0 (CSV imports), omit the footer entirely

**Examples:**

```
API Calls: 47 · alchemy: 2, etherscan: 45 (10 retries, 12 rate-limited, 2 failed)
API Calls: 12 · etherscan: 12
```

#### After Completion (Detailed Breakdown)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API Calls: {total} total
  ├─ {provider1}: {count} calls
  │  ├─ OK: {okCount} ({statusCode})
  │  ├─ Rate Limited: {rateLimitCount} ({statusCode})
  │  ├─ Retries: {retryCount}
  │  └─ Error: {errorCount} ({statusCode})
  ├─ {provider2}: {count} calls
  │  └─ OK: {okCount} ({statusCode})
  └─ {providerN}: {count} calls
```

**Rules:**

1. Only show OK/Rate Limited/Retries/Error lines if > 0
2. If provider has only OK responses, use single line: `└─ OK: {count} ({statusCode})`
3. Show providers in alphabetical order
4. Show providers with 0 calls: `{provider}: 0 calls`

### Warning/Error Footer

**Format:**

```
⚠ Completed with {warningCount} warning(s) ({totalDuration} total)
   {warningMessage1}
   {warningMessage2}
```

**Rules:**

1. Only show if warnings exist
2. Show total duration in parens
3. Each warning message on new line with 3-space indent
4. Use singular "warning" if count is 1

### Account Status

**New account (first import):**

```
✓ Account #{accountId}
```

**Resuming account:**

```
✓ Account #{accountId} (resuming from previous import)
```

**Rule:** Determine by checking if account has existing transactions in database.

### Transient Messages (Rate Limit & Failover)

**Display logic:**

1. Store message with timestamp when event occurs
2. Replace req/s line with message
3. After specified duration OR next batch, revert to req/s display

**Rate limit message:**

- Duration: While waiting (updates countdown every 250ms)
- Format: `⏸ waiting {remainingMs}ms (rate limit)` or `⏸ waiting {remainingSeconds}s (rate limit)`
- Reverts to req/s when wait completes

**Failover message:**

- Duration: 3 seconds
- Format: `↻ switched to {newProvider} ({oldProvider} {reason})`
- Reverts to req/s after 3 seconds

**Implementation note:**

```typescript
interface TransientMessage {
  text: string;
  expiresAt: number; // timestamp
}

// On render:
if (transientMessage && Date.now() < transientMessage.expiresAt) {
  display(transientMessage.text);
} else {
  display(normalReqsInfo);
}
```

**Scope:** Import stream sub-lines and the processing token metadata line. During processing, metadata fetching goes through the same providers and HTTP clients — rate limits and failovers surface identically.

### Tree Characters

```typescript
const TREE_CHARS = {
  branch: '├─ ', // Middle child
  last: '└─ ', // Last child
  continue: '│  ', // Vertical line continuation
  indent: '   ', // 3 spaces for sub-items
} as const;
```

**Usage:**

```
Import
├─ Stream 1         ← branch
├─ Stream 2         ← branch
└─ Stream 3         ← last
   └─ Sub-item      ← indent(3) + last
```

### Update Frequency

- **Display refresh:** 250ms
- **Time calculations:** Use current timestamp, format dynamically
- **API stats:** Recalculate on every refresh
- **Transient messages:** Check expiry on every refresh

### CSV Import (Simplified)

**No API calls - omit footer:**

```
✓ Import from CSV ({duration})
  └─ {streamName}: {count} new
✓ Processing ({duration})
  └─ {count} transactions enriched

✓ Completed ({totalDuration} total)
```

**Rules:**

1. No provider info (no req/s)
2. No API footer section
3. Simpler structure - no batches, just final count

---

## Next Steps

All UX decisions finalized! Ready to create:

1. **State model spec** - Data structure for operation tree
2. **Event mapping spec** - How events update the state
3. **Implementation plan** - File structure and build approach

Proceed to state model?
