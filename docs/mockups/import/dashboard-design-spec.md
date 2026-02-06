# Dashboard - UX/Visual Design Specification

## Design Philosophy

**Operation tree** - Live status of what's happening now + what completed

### Key Features

- **No timestamps** - Focus on status and duration, not when
- **Hierarchical** - Tree structure shows parent/child operations
- **Live updates** - Lines update in place, not append
- **Status-first** - Icons show state at a glance (✓/⠋/⚠)

---

## Operation Tree Color Specification

### Three-Tier Semantic System

Colors follow a three-tier hierarchy optimized for scanning efficiency:

1. **Signal** — Icons only (`✓` green, `⠋` cyan, `⚠` yellow) — glanceable from across the room
2. **Content** — Names and numbers (white/bold labels, green counts, cyan rates) — what you read
3. **Context** — Durations, parentheticals, tree chars, labels (dim) — there if you need it, invisible if you don't

This hierarchy ensures that even at a fast scroll, green checkmarks + one cyan spinner tells the whole story. Stop and read, the numbers are there. Debugging? The dim details fill in the gaps.

---

### Completed State Colors

Example:

```
✓ Account #42 (resuming)
✓ 4 providers ready
✓ Importing (3m 47s)
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: 3,891 new (3m 44s)
  └─ Beacon: ⚠ Failed (800ms)
✓ Processing (1m 23s)
  ├─ 3,891 raw → 3,245 transactions
  ├─ Token metadata: 2,847 cached, 156 fetched (95% cached)
  └─ ⚠ 12 scam tokens (SHIB, PEPE, RUG)
```

| Element                                                         | Color                                                                      | Why                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| `✓`                                                             | **green**                                                                  | Universal "success" signal                            |
| `⚠`                                                             | **yellow**                                                                 | Warning — not fatal, but notable                      |
| Phase labels: `Importing`, `Processing`                         | **white/bold**                                                             | These are the structural headings — anchor points     |
| `Created account #42`, `Account #42`, `4 providers ready`       | **white**                                                                  | Top-level status, important                           |
| `(resuming)`                                                    | **dim**                                                                    | Context detail, not the main info                     |
| Stream names: `Normal`, `Internal`, `Token Transfers`, `Beacon` | **white**                                                                  | The "what" — should be readable                       |
| Counts: `0 new`, `3,891 new`                                    | **green**                                                                  | Data results — the "answer" you're looking for        |
| `Failed`                                                        | **yellow**                                                                 | Matches the `⚠` — it's a warning, not red (non-fatal) |
| Durations: `(91ms)`, `(3m 47s)`, `(300ms)`                      | **dim**                                                                    | Always secondary — useful but never the headline      |
| Tree chars: `├─`, `└─`, `│`                                     | **dim**                                                                    | Structural scaffolding, should recede                 |
| `3,891 raw → 3,245 transactions`                                | **green** `3,891` **dim** `raw →` **green** `3,245` **dim** `transactions` | Numbers pop, labels recede                            |
| `2,847 cached, 156 fetched`                                     | **green** `2,847 cached` · **cyan** `156 fetched`                          | Cached = done/good, fetched = work that happened      |
| `(95% cached)`                                                  | **dim**                                                                    | Summary stat, parenthetical                           |
| `12 scam tokens`                                                | **yellow**                                                                 | Matches `⚠`                                           |
| `(SHIB, PEPE, RUG)`                                             | **dim**                                                                    | Examples, detail                                      |

---

### Live State Colors

Example:

```
✓ Account #42 (resuming)
✓ 4 providers ready
⠋ Importing · 2m 15s
  ├─ Normal: 0 new (300ms)
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · etherscan 3.2/4 req/s
```

| Element                    | Color          | Notes                                                      |
| -------------------------- | -------------- | ---------------------------------------------------------- |
| `⠋`                        | **cyan**       | Spinner stands out as "active"                             |
| `Importing`                | **white/bold** | Same as completed                                          |
| `· 2m 15s` (live duration) | **dim**        | Ticking clock, secondary                                   |
| `batch 12`                 | **white**      | Current progress marker                                    |
| `3,891 imported`           | **green**      | Same as counts above                                       |
| `etherscan`                | **cyan**       | Provider name — matches the rate color in the footer table |
| `3.2/4 req/s`              | **cyan**       | Rate info, same color system as footer                     |

---

### Color Semantic Rules

**Icons (Signal tier):**

- `✓` (completed): **green**
- `⠋` (spinner/active): **cyan**
- `⚠` (warning): **yellow**
- `↻` (switched): **cyan** (matches active/in-progress)
- `⏸` (waiting): **cyan** (matches active/in-progress)

**Content tier (what you read):**

- Phase labels (`Importing`, `Processing`): **white/bold**
- Stream names: **white**
- Batch/progress markers: **white**
- Counts/numbers (success): **green**
- Provider names (active): **cyan**
- Rates: **cyan**
- `cached` counts: **green** (completed work)
- `fetched` counts: **cyan** (work that happened)

**Warning tier:**

- `Failed`: **yellow**
- Scam token counts: **yellow**
- Warning counts: **yellow**

**Context tier (recedes):**

- All durations (parenthetical and live): **dim**
- Tree characters (`├─`, `└─`, `│`): **dim**
- Contextual text (`raw →`, `transactions`, `cached`): **dim**
- Parenthetical details: **dim**
- Status codes: **dim**

**Consistency rules:**

1. All numbers representing "answers" or results: **green**
2. All metrics representing "activity" or rates: **cyan**
3. All structural elements: **dim**
4. All warnings/failures: **yellow** (not red — failures are non-fatal)

---

## Complete Visual Examples

### Example 1: Fresh Import Start

**Streams appear only when active (when they publish events):**

```
✓ Created account #42
✓ 4 providers ready
⠋ Importing · 200ms
  └─ Normal: batch 1 · 200ms
     └─ 0 imported · etherscan 3.1/4 req/s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1 API call
  etherscan     ● 3.1 req/s   120ms    1 ok
  alchemy       ○ idle          —       0
  moralis       ○ idle          —       0
```

---

### Example 2: Multi-Stream In Progress

```
✓ Account #42 (resuming)
✓ 4 providers ready
⠋ Importing · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · etherscan 3.2/4 req/s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  alchemy       ○ idle        140ms     2 ok
  etherscan     ● 3.2 req/s   278ms    45 ok · 12 throttled · 2 err
  moralis       ○ idle          —       0
```

---

### Example 3: Rate Limit Wait

**During wait (replaces req/s temporarily):**

```
⠋ Importing · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ⏸ waiting 187ms (rate limit)
```

**After wait completes (req/s returns):**

```
⠋ Importing · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · etherscan 3.2/4 req/s
```

---

### Example 4: Provider Failover

**For 3 seconds (replaces req/s):**

```
✓ Account #42 (resuming)
✓ 4 providers ready
⠋ Importing · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ↻ switched to alchemy (etherscan rate limited)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  alchemy       ● 2.1 req/s   140ms     2 ok
  etherscan     ○ idle        278ms    45 ok · 12 throttled
  moralis       ○ idle          —       0
```

**After 3 seconds (normal req/s display):**

```
✓ Account #42 (resuming)
✓ 4 providers ready
⠋ Importing · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · alchemy 2.1/4 req/s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  alchemy       ● 2.1 req/s   140ms     2 ok
  etherscan     ○ idle        278ms    45 ok · 12 throttled
  moralis       ○ idle          —       0
```

---

### Example 5: Stream Failure

**Expanded with details (Option A):**

```
✓ Account #42 (resuming)
✓ 4 providers ready
⠋ Importing · 2m 15s
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: batch 12 · 2m 14s
  │  └─ 3,891 imported · etherscan 3.2/4 req/s
  └─ Beacon: ⚠ Failed (800ms)
     └─ Rate limit exceeded - try setting ETHERSCAN_API_KEY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
48 API calls
  alchemy       ○ idle          —       0
  etherscan     ● 3.2 req/s   278ms    47 ok · 1 err
  moralis       ○ idle          —       0
```

---

### Example 6: Import Complete → Processing

```
✓ Account #42 (resuming)
✓ 4 providers ready
✓ Importing (3m 47s)
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: 3,891 new (3m 44s)
  └─ Beacon: ⚠ Failed (800ms)
⠋ Processing · 500ms
  ├─ 847 / 3,891 raw transactions
  ├─ Token metadata: 745 cached, 34 fetched · etherscan 3.1/4 req/s
  └─ ⚠ 2 scam tokens (SHIB, PEPE)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  alchemy       ○ idle        140ms     2 ok
  etherscan     ● 3.1 req/s   278ms    45 ok
  moralis       ○ idle          —       0
```

---

### Example 7: Final Completion (with warnings)

```
✓ Account #42 (resuming)
✓ 4 providers ready
✓ Importing (3m 47s)
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: 3,891 new (3m 44s)
  └─ Beacon: ⚠ Failed (800ms)
✓ Processing (1m 23s)
  ├─ 3,891 raw → 3,245 transactions
  ├─ Token metadata: 2,847 cached, 156 fetched (95% cached)
  └─ ⚠ 12 scam tokens (SHIB, PEPE, RUG)

⚠ Completed with 1 warning (5m 11s)
   Beacon withdrawals unavailable - balance may be incomplete

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  alchemy       0.1 req/s   140ms     2 calls    2 ok (200)
  etherscan     1.4 req/s   278ms    45 calls   31 ok (200) · 12 throttled (429) · 10 retries · 2 err (503)
  moralis       —            —        0 calls
```

**✓ Answered:**

1. Warning/error section at **bottom**
2. Expanded API stats with **OK/Rate-Limited/Error breakdown with HTTP codes**
3. Token metadata **integrated under processing steps**

---

## Provider Metrics Footer Specification

### Core Principle

**Separate operation status from infrastructure status:**

- **Operation tree** = what's happening to your data (uses tree characters `├─ └─`)
- **Provider metrics footer** = what's happening to your network (uses tabular rows)

These must be visually distinct. Tree characters belong to operations only.

---

### During Import (Live - 250ms refresh)

**Compact table format - one row per provider:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  etherscan     ● 3.2 req/s   278ms    45 ok · 12 throttled · 2 err
  alchemy       ○ idle        140ms     2 ok
  moralis       ○ idle          —       0
```

**Column structure:**

1. **Provider name** (left-aligned, 12 char width)
2. **Status + Rate** (18 char width)
   - Active: `● X.X req/s` (green dot, cyan rate)
   - Idle: `○ idle` (dimmed)
3. **Latency** (6 char width, right-aligned, dimmed)
   - Active/idle with calls: `278ms`
   - Zero calls: `—`
4. **Counts** (left-aligned, flexible width)
   - Format: `N ok · N throttled · N err`
   - Omit zero counts
   - Zero calls: just `0`

**Visual hierarchy:**

- Green `●` dot pulls eye to active provider
- Cyan rate shows how fast
- Color-coded counts (green ok, yellow throttled, red err)
- Idle rows fully dimmed
- Static alphabetical order (no jumping)

---

### After Completion (Detailed Breakdown)

**Same table structure, different semantics:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  etherscan     1.4 req/s   278ms    45 calls   31 ok (200) · 12 throttled (429) · 10 retries · 2 err (503)
  alchemy       0.1 req/s   140ms     2 calls    2 ok (200)
  moralis       —            —        0 calls
```

**Changes from live:**

1. **No status dots** — everything is done, active/idle distinction gone
2. **Rate = average** — `totalCalls / totalElapsedSeconds` (still cyan)
3. **HTTP status codes** — appear in dimmed parens after each status type
4. **Retry count** — separated out explicitly
5. **Zero-call providers** — show `—` for both rate and latency

**Column structure:**

1. Provider name (same as live)
2. **Avg rate** (18 char width)
   - Calculation: `totalCalls / totalElapsedSeconds`
   - Format: `1.4 req/s` (cyan)
   - Zero calls: `—` (dimmed)
3. Avg latency (same as live)
4. **Total calls + breakdown** (flexible width)
   - Format: `N calls   N ok (XXX) · N throttled (XXX) · N retries · N err (XXX)`
   - HTTP status codes in parens
   - Omit zero counts
   - Zero calls: just `0 calls`

---

### Color Mappings

#### Live View Colors

| Element                 | Color            | Rationale                        |
| ----------------------- | ---------------- | -------------------------------- |
| `●` (active dot)        | **green**        | Instant "this is working" signal |
| Provider name (active)  | **white/bright** | Full brightness for active rows  |
| `3.2 req/s`             | **cyan**         | Stands out as a metric           |
| `○ idle`                | **dim/gray**     | Entire phrase dims               |
| Provider name (idle)    | **dim/gray**     | Whole row recedes                |
| Latency (`278ms`)       | **dim**          | Useful but secondary             |
| `—` (no data)           | **dim**          | Nothing to see                   |
| `ok` count              | **green**        | Success                          |
| `throttled` count       | **yellow**       | Caution, not error               |
| `err` count             | **red**          | Immediate attention              |
| `0` (zero calls)        | **dim**          | Not interesting                  |
| Divider `━━━`           | **dim**          | Structural only                  |
| `47 API calls` (header) | **white/bold**   | Section anchor                   |

#### Completed View Colors

| Element                              | Color            | Change from live                         |
| ------------------------------------ | ---------------- | ---------------------------------------- |
| Provider name                        | **normal white** | No more active/idle distinction          |
| Avg rate (`1.4 req/s`)               | **cyan**         | Same as live, signals it's a rate metric |
| `—` (no rate)                        | **dim**          | Zero-call providers                      |
| Latency                              | **dim**          | Same as live                             |
| `ok (200)`                           | **green**        | Same as live                             |
| `throttled (429)`                    | **yellow**       | Same as live                             |
| `retries`                            | **yellow**       | Groups with throttled (caution tier)     |
| `err (503)`                          | **red**          | Same as live                             |
| Status codes `(200)` `(429)` `(503)` | **dim**          | Detail layer, not headline               |
| `calls` keyword                      | **normal white** | Just text                                |
| `0 calls`                            | **dim**          | Same as live                             |

**Design principle:** Color carries the semantic layer, text carries the detail layer.

---

### Live vs Completed Semantics

| Aspect            | Live                            | Completed                    |
| ----------------- | ------------------------------- | ---------------------------- |
| **Purpose**       | Real-time monitoring            | Post-mortem summary          |
| **Status dots**   | Yes (`●` active, `○` idle)      | No (everything is done)      |
| **Rate**          | Instantaneous (recent activity) | Average over full run        |
| **Counts**        | Running totals                  | Final totals with HTTP codes |
| **Retries**       | Not shown (still in flux)       | Explicit count (finalized)   |
| **Visual weight** | Active rows pop, idle rows dim  | All rows equal weight        |

---

### Edge Cases

#### Single Provider

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
etherscan     ● 3.2 req/s   278ms    47 ok · 12 throttled
```

No header, no indent. Indent means "belongs to the line above" — no line above, no indent.

#### No API Calls

```
(footer omitted entirely)
```

Nothing to show — common for CSV imports.

#### All Providers Idle

```
0 API calls
  etherscan     ○ idle          —       0
  alchemy       ○ idle          —       0
  moralis       ○ idle          —       0
```

All dimmed. Unusual but valid.

#### Zero-Call Providers (Live)

```
  moralis       ○ idle          —       0
```

Shows they're registered but unused.

#### Zero-Call Providers (Completed)

```
  moralis       —            —        0 calls
```

Three `—` marks make it clear "nothing happened."

---

### Implementation Notes

**Column widths:**

```
  etherscan     ● 3.2 req/s   278ms    45 ok · 12 throttled · 2 err
  ^12 chars^    ^18 chars ^   ^6ch^    ^flexible, left-aligned^
```

**Provider ordering:**

- Static alphabetical order (never jump around)
- Predictable position → faster visual scanning

**Rate calculation (live):**

- Instantaneous: recent calls / recent time window (e.g., last 5 seconds)

**Rate calculation (completed):**

- Average: `totalCalls / (completionTime - startTime)`

**Active/idle determination:**

- Provider is active if `now - lastCallTime < 2s`

**Data tracking per provider:**

- `totalCalls`, `okCount`, `throttledCount`, `errorCount`, `retryCount`
- `statusCodes` (map of code → count for completion view)
- `latencies` (array or running average)
- `startTime`, `lastCallTime`

---

## Edge Cases

### Example 8: Final Completion (success, no warnings)

```
✓ Account #42 (resuming)
✓ 4 providers ready
✓ Importing (3m 47s)
  ├─ Normal: 127 new (300ms)
  ├─ Internal: 45 new (200ms)
  └─ Token Transfers: 3,891 new (3m 44s)
✓ Processing (1m 23s)
  ├─ 4,063 raw → 3,892 transactions
  └─ Token metadata: 2,847 cached, 156 fetched (95% cached)

✓ Done (5m 10s)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  alchemy       0.1 req/s   140ms     2 calls    2 ok (200)
  etherscan     1.4 req/s   278ms    45 calls   31 ok (200) · 12 throttled (429) · 10 retries · 2 err (503)
  moralis       —            —        0 calls
```

---

### Empty Import (No Transactions)

```
✓ Account #42 (resuming)
✓ 4 providers ready
✓ Importing (800ms)
  ├─ Normal: 0 new (300ms)
  ├─ Internal: 0 new (200ms)
  ├─ Token Transfers: 0 new (200ms)
  └─ Beacon: 0 new (100ms)
✓ Processing (100ms)
  └─ No transactions to process

✓ Done (900ms)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4 API calls
  alchemy       —            —        0 calls
  etherscan     5.0 req/s   120ms     4 calls    4 ok (200)
  moralis       —            —        0 calls
```

---

### CSV Import (No API Calls)

```
✓ Importing from CSV (200ms)
  └─ Trades: 142 new
✓ Processing (400ms)
  └─ 142 transactions enriched

✓ Done (600ms)
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

**Note:** API footer format has been completely redesigned. See "Provider Metrics Footer Specification" section above for the new tabular design.

✓ **Final summary placement** - Bottom
✓ **API stats expansion** - Yes, tabular format with status dots, rates, latency, and color-coded counts
✓ **Token metadata** - Processing sub-line with provider/rate live, hit rate at completion
✓ **Live API monitoring** - Yes, update every 250ms with per-provider rows
✓ **API breakdown format** - Tabular rows (not tree characters), HTTP codes in completion view
✓ **Retry tracking** - Yes, shown in completion view
✓ **Avg req/s in completion** - Yes, kept in same column as live rate
✓ **CSV imports** - No API section, simpler structure
✓ **Empty streams** - Say "No new transactions" when resuming
✓ **Resume tracking** - "x new" suffices for completed streams
✓ **API session distinction** - Just current session
✓ **Page display** - Use **batches** instead (events already exist)
✓ **Items display** - Cumulative (increases "imported")
✓ **Information priority** - Confirmed correct

### Reprocessing (Single Account)

**Shows account info with transaction counts before processing:**

```
✓ Account #42 (resuming · 34,891 transactions)
  normal: 32,717 · internal: 1,204 · token: 956 · beacon: 14
⠋ Processing · 500ms
  ├─ 847 / 34,891 raw transactions
  ├─ Token metadata: 745 cached, 34 fetched · etherscan 3.1/4 req/s
  └─ ⚠ 2 scam tokens (SHIB, PEPE)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47 API calls
  alchemy       ○ idle        140ms     2 ok
  etherscan     ● 3.1 req/s   278ms    45 ok
  moralis       ○ idle          —       0
```

**Notes:**

- Same account display format as resuming import
- Total transaction count from all stream types shown in parenthetical
- Transaction breakdown by stream type on second line
- Provides context about what's being reprocessed

## Final Decisions Summary

✓ **Streams** - Appear only when active
✓ **Empty streams** - Show "0 new"
✓ **Completed streams** - Keep visible, don't collapse
✓ **Page display** - Use **batches** instead (events already exist)
✓ **Rate limit display** - Replace req/s temporarily (Option C - no flicker)
✓ **Failover display** - Replace req/s temporarily, show 3 seconds
✓ **Failure display** - Expanded with details (Option A)
✓ **Processing phase** - Keep import streams visible; sub-lines: raw progress, token metadata (provider/rate live), scam tokens
✓ **API calls** - Keep visible during processing; tabular format (not tree characters)
✓ **API footer design** - Tabular rows with status dots, rates, latency, color-coded counts; keeps avg req/s in completion view
✓ **Time precision** - Decimals (12.3s)
✓ **Account status** - Show account #, indicate if resuming
✓ **Resume cursor** - Don't show (future improvement)

---

## Final Visual Examples

### Rate Limit (no flicker)

```
⠋ Importing · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ⏸ waiting 187ms (rate limit)
```

After wait completes:

```
⠋ Importing · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · etherscan 3.2/4 req/s
```

### Failover (no flicker)

```
⠋ Importing · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · ↻ switched to alchemy (3s)
```

After 3 seconds:

```
⠋ Importing · 2m 15s
  └─ Token Transfers: batch 12 · 2m 14s
     └─ 3,891 imported · alchemy 2.1/4 req/s
```

### Account Status

**New account:**

```
✓ Created account #42
✓ 4 providers ready
⠋ Importing · 200ms
  └─ Normal: batch 1 · 200ms
```

**Resuming account:**

```
✓ Account #42 (resuming · 34,891 transactions)
  normal: 32,717 · internal: 1,204 · token: 956 · beacon: 14
✓ 4 providers ready
⠋ Importing · 200ms
  ├─ Normal: 0 new (300ms)
  └─ Token Transfers: batch 1 · 200ms
     └─ 127 imported · etherscan 3.2/4 req/s
```

**Notes:**

- Transaction counts shown on second line with inline `·` separators
- Sorted by count descending for scannable hierarchy
- Only shown when resuming (not for new accounts)

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
⠋ Importing · {duration}
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

**See "Provider Metrics Footer Specification" section above for full details.**

#### During Import (Live - Update every 250ms)

**Tabular format - one row per provider:**

Multiple providers:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{totalCalls} API calls
  {provider1}     {status} {rate}   {latency}    {counts}
  {provider2}     {status} {rate}   {latency}    {counts}
  {provider3}     {status} {rate}   {latency}    {counts}
```

Single provider (no header, no indent):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{provider1}     {status} {rate}   {latency}    {counts}
```

**Column structure:**

| Column        | Width    | Content                                   | Example                        |
| ------------- | -------- | ----------------------------------------- | ------------------------------ |
| Provider name | 12 chars | Left-aligned, truncate with `…` if needed | `etherscan  `                  |
| Status + Rate | 18 chars | `● X.X req/s` (active) or `○ idle` (idle) | `● 3.2 req/s  `                |
| Latency       | 6 chars  | Right-aligned, `Nms` or `—`               | ` 278ms`                       |
| Counts        | Flexible | `N ok · N throttled · N err` (omit zeros) | `45 ok · 12 throttled · 2 err` |

**Color mapping (picocolors):**

```typescript
// Active provider row
`  ${providerName.padEnd(12)}  ${pc.green('●')} ${pc.cyan(rate.padEnd(10))}  ${pc.dim(latency.padStart(6))}   ${pc.green(`${ok} ok`)} · ${pc.yellow(`${throttled} throttled`)} · ${pc.red(`${err} err`)}`
// Idle provider row (all dimmed)
`  ${pc.dim(providerName.padEnd(12))}  ${pc.dim('○ idle'.padEnd(18))}  ${pc.dim(latency.padStart(6))}   ${pc.green(`${ok} ok`)}`
// Zero-call provider (all dimmed except structure)
`  ${pc.dim(providerName.padEnd(12))}  ${pc.dim('○ idle'.padEnd(18))}  ${pc.dim('—'.padStart(6))}   ${pc.dim('0')}`;
```

**Rules:**

1. Static alphabetical order (never reorder)
2. Active = `now - lastCallTime < 2s`
3. Rate = instantaneous (recent calls / last 5 seconds)
4. Omit footer entirely if `totalCalls === 0`
5. Single provider: omit header and indent (flush left)

**Data tracking per provider:**

```typescript
interface ProviderMetrics {
  totalCalls: number;
  okCount: number;
  throttledCount: number;
  errorCount: number;
  retryCount: number;
  statusCodes: Map<number, number>; // For completion view
  latencies: number[]; // For avg calculation
  startTime: number;
  lastCallTime: number;
}
```

#### After Completion (Detailed Breakdown)

**Same structure, different semantics:**

Multiple providers:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{totalCalls} API calls
  {provider1}     {avgRate}   {avgLatency}    {totalCalls} calls   {breakdown}
  {provider2}     {avgRate}   {avgLatency}    {totalCalls} calls   {breakdown}
  {provider3}     {avgRate}   {avgLatency}    {totalCalls} calls   {breakdown}
```

Single provider (no header, no indent):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{provider1}     {avgRate}   {avgLatency}    {totalCalls} calls   {breakdown}
```

**Changes from live:**

1. **No status dots** (all done)
2. **Avg rate** = `totalCalls / (endTime - startTime)` (still cyan)
3. **HTTP status codes** in dimmed parens: `31 ok (200) · 12 throttled (429)`
4. **Retries** shown explicitly: `10 retries`
5. **Zero-call providers**: `—` for rate and latency, `0 calls` for counts

**Breakdown format:**

- Full: `N ok (XXX) · N throttled (XXX) · N retries · N err (XXX)`
- Omit zero counts
- Status codes in dimmed parens
- Example: `31 ok (200) · 12 throttled (429) · 10 retries · 2 err (503)`

**Color mapping (changes from live):**

```typescript
// Completed row with details
`  ${providerName.padEnd(12)}  ${pc.cyan(avgRate.padEnd(10))}  ${pc.dim(avgLatency.padStart(6))}   ${totalCalls} calls   ${pc.green(`${ok} ok`)} ${pc.dim(`(${statusCode})}`)} · ${pc.yellow(`${throttled} throttled`)} ${pc.dim(`(429)`)} · ${pc.yellow(`${retries} retries`)} · ${pc.red(`${err} err`)} ${pc.dim(`(503)`)}`
// Zero-call provider
`  ${pc.dim(providerName.padEnd(12))}  ${pc.dim('—'.padEnd(18))}  ${pc.dim('—'.padStart(6))}   ${pc.dim('0 calls')}`;
```

**Color rules:**

- All provider names: normal white (no dimming)
- Avg rate: cyan (same as live)
- Status codes `(200)` `(429)`: dimmed
- `retries`: yellow (groups with throttled)
- Everything else: same as live

### Completion Status

**Success (no warnings):**

```
✓ Done ({totalDuration})
```

**Aborted (Ctrl-C or error):**

```
⚠ Aborted ({totalDuration})
```

**With warnings:**

```
⚠ Completed with {warningCount} warning(s) ({totalDuration})
   {warningMessage1}
   {warningMessage2}
```

**Rules:**

1. Always shown when `isComplete` is true
2. Priority: `aborted` flag → warnings → success
3. Show `⚠ Aborted` if aborted flag set (Ctrl-C or fatal error)
4. Show `⚠ Completed with N warnings` if warnings exist
5. Show `✓ Done` for clean success
6. Duration without "total" suffix
7. Each warning message on new line with 3-space indent
8. Use singular "warning" if count is 1
9. Appears BEFORE the API footer (completion status → API stats)

**Implementation:**

Ctrl-C (SIGINT) is handled gracefully:

- Signal handler calls `dashboard.abort()` which sets `state.aborted = true`
- Dashboard re-renders with abort state
- Process exits after 500ms delay to allow final render
- Same handler applies to both `import` and `reprocess` commands

### Account Status

**New account (first import):**

```
✓ Created account #{accountId}
```

**Resuming account:**

```
✓ Account #{accountId} (resuming)
```

**Display order:** Account comes FIRST, before provider readiness (account answers "what am I operating on?", then providers answer "what tools do I have?")

**Rule:** Determined by the `isNewAccount` flag from `import.started` event (false means has prior data).

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
Importing
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
✓ Importing from CSV ({duration})
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
