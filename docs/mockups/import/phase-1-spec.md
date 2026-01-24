# Phase 1/2: Import Dashboard Specification

## Overview

Real-time dashboard during blockchain import showing provider health, request velocity, and import progress. Updates every 250ms using `log-update` for atomic frame redraws.

## Layout Structure

```
┌─ HEADER (static) ────────────────────────────────────────────────┐
│ EXITBOOK CLI  v2.1.0  |  Target: 0xd8da...9d7e  |  Session: #184 │
│ [● PHASE 1/2: IMPORTING]                                         │
└──────────────────────────────────────────────────────────────────┘

┌─ BODY (dynamic) ─────────────────────────────────────────────────┐
│                                                                  │
│  [ VELOCITY & SAFETY ]                                           │
│  Shows: current req/s, request progress bar                      │
│                                                                  │
│  [ PROVIDER STATUS ]                                             │
│  Table: provider | status | latency | req/s | throttles          │
│                                                                  │
│  [ IMPORT PROGRESS ]                                             │
│  Shows: transactions found, time elapsed                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─ FOOTER (scrolling log, persists across phases) ─────────────────┐
│ 15:12:40 ℹ Saved batch of 1000 transactions                      │
│ 15:12:41 ⚠ etherscan: Rate limited, backing off 334ms            │
│ 15:12:42 ⇄ Switched to routescan                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Sources (What Exists)

### Available Now

- **InstrumentationCollector**: Tracks all HTTP requests with provider, endpoint, status, duration, timestamp
- **Provider Events**: rate_limited, circuit_open, backoff, failover, selection
- **ProgressHandler**: Already subscribes to import/process/provider events
- **Import Events**: batch progress (new/skipped counts, total imported)

### Need to Add

- **Velocity Calculator**: Derive req/s from instrumentation timestamps (rolling 5s window)
- **Provider State Aggregator**: Combine instrumentation + events to build provider matrix
- **Throttle Counter**: Track cumulative rate limit hits per provider from events

---

## Section: Velocity

```
[ VELOCITY ]
VELOCITY:   142 req/s  [||||||||||||||||||||] !
```

### Fields

| Field        | Source                           | Update | Logic                                                                                                         |
| ------------ | -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `142 req/s`  | InstrumentationCollector.metrics | 250ms  | Count requests in last 5 seconds, divide by 5                                                                 |
| Progress bar | velocity value                   | 250ms  | 20-char bar: `│` filled, `░` empty. **Fixed scale: 0-100 req/s**. If >100, bar stays full + add `!` indicator |

### Implementation Notes

**Fixed Scale Rationale**:

- Dynamic scaling (to max observed) breaks when you hit a spike - 1000 req/s makes normal 50 req/s look tiny
- Fixed scale lets you see normal vs abnormal at a glance
- If velocity exceeds 100 req/s, show full bar with `!` indicator (e.g., `[||||||||||||||||||||] ! 142 req/s`)

---

## Section: Provider Status

```
[ PROVIDER STATUS ]
┌──────────────┬────────────┬─────────┬─────────┬──────────┐
│ PROVIDER     │ STATUS     │ LATENCY │ REQ/S   │ THROTTLES│
├──────────────┼────────────┼─────────┼─────────┼──────────┤
│ etherscan    │ ⚠ WAIT 334ms │ 334ms   │ 45 req/s │ 14       │
│ routescan    │ 🟢 ACTIVE    │ 380ms   │ 97 req/s │ 0        │
└──────────────┴────────────┴─────────┴─────────┴──────────┘
```

### Data Sources Per Provider

| Column    | Source                          | Calculation                                              |
| --------- | ------------------------------- | -------------------------------------------------------- |
| PROVIDER  | Active providers from manager   | Sorted by req/s (most active first)                      |
| STATUS    | Provider events + circuit state | See status logic below                                   |
| LATENCY   | InstrumentationCollector        | Average duration from last 10 requests for this provider |
| REQ/S     | InstrumentationCollector        | Count this provider's requests in last 5s, divide by 5   |
| THROTTLES | Provider events                 | Cumulative count of `provider.rate_limited` events       |

### Status Logic

**Priority order** (show first match):

1. **Rate Limited**: If `provider.rate_limited` event received, show `⚠ WAIT {ms}` (countdown from `retryAfterMs`)
2. **Circuit Open**: If `provider.circuit_open` event received, show `🔴 CIRCUIT`
3. **Active**: If req/s > 10 in last 5s, show `🟢 ACTIVE`
4. **Idle**: Otherwise show `⚪ IDLE`

### Implementation Notes

**Provider State Tracking:**

- Subscribe to provider events in ProgressHandler
- Track per-provider counters: throttle count, backoff state, circuit state
- Query InstrumentationCollector for latency/velocity metrics
- Rebuild table every 250ms from current state
- **Show all active providers** (no limiting - EVM has <5 providers typically)

**Empty State Handling:**

- If no providers active (e.g., CSV import), show `"No providers active"` instead of empty table
- If instrumentation disabled, velocity section shows `"N/A (instrumentation disabled)"`

**Countdown Timers:**

- When rate limited, store `resumeAt = Date.now() + retryAfterMs`
- Display `WAIT {ms}` as countdown: `resumeAt - Date.now()`
- Clear countdown when:
  - New request succeeds, OR
  - Timer reaches 0ms (prevents stuck "WAIT 0ms" if orchestrator doesn't retry immediately)

**Latency Calculation:**

- Filter out 429 (rate limit) responses from latency average
- Rationale: 429s are fast failures (~10ms rejection), including them artificially lowers displayed latency
- Only calculate from successful requests (2xx status codes)

---

## Section: Import Progress

```
[ IMPORT PROGRESS ]
Transactions:  152,640
Time Elapsed:  00:45
```

| Field        | Source                             | Format                       |
| ------------ | ---------------------------------- | ---------------------------- |
| Transactions | import.batch event (totalImported) | Number with comma separators |
| Time Elapsed | import.started timestamp           | `mm:ss` format               |

**Update**: Every 250ms during import phase

---

## Event Log (Footer)

```
──────────────────────────────────────────────────────────
[ EVENTS ]
15:12:40  ℹ  Saved batch of 1000 transactions
15:12:41  ⚠  etherscan: Rate limited, backing off 334ms
15:12:42  ⇄  Switched to routescan
```

### Behavior

- Show last **3 events** only
- Scroll from bottom (newest at bottom)
- Persists across phase transitions (import → processing → complete)
- Update on new event arrival

### Event Sources

**Current events to show:**

- `import.batch` → "Saved batch of {n} transactions"
- `provider.rate_limited` → "⚠ {provider}: Rate limited, backing off {ms}ms"
- `provider.failover` → "⇄ Switched to {to} from {from}"
- `provider.circuit_open` → "🔴 {provider}: Circuit breaker opened ({reason})"

**Filter out:**

- `provider.request.started/succeeded/failed` (too noisy)
- `provider.selection` (only for initial selection)

---

## Implementation Approach

### 1. Enhance ProgressHandler

**Add fields:**

```typescript
private velocityTracker = new VelocityTracker();
private providerStates = new Map<string, ProviderState>();
private instrumentation?: InstrumentationCollector;
```

**Extend handleEvent:**

- Track provider events (rate_limited, circuit_open, backoff)
- Update provider state counters
- Store instrumentation reference

### 2. Create VelocityTracker utility

```typescript
class VelocityTracker {
  // Calculate requests per second from instrumentation metrics
  getRequestsPerSecond(metrics: RequestMetric[]): number;

  // Calculate per-provider requests per second
  getProviderVelocity(metrics: RequestMetric[], provider: string): number;
}
```

### 3. Create ProviderStateAggregator utility

```typescript
class ProviderStateAggregator {
  // Build provider matrix rows from events + instrumentation
  getProviderRows(providerStates: Map<string, ProviderState>, metrics: RequestMetric[]): ProviderRow[];
}
```

### 4. Add renderImportDashboard method to ProgressHandler

- Call VelocityTracker to get velocity metrics
- Call ProviderStateAggregator to get provider table rows
- Build box-drawing table with provider status
- Update frame via log-update

---

## Requirements

**HTTP Instrumentation Required**: Dashboard requires `InstrumentationCollector` to be enabled for:

- Overall velocity (req/s)
- Per-provider latency
- Per-provider req/s

Non-instrumentation fallback can be added later if needed.

**Update Interval**: Define constant `DASHBOARD_UPDATE_INTERVAL_MS = 250` for frame refresh rate.

**Error Boundaries**: Wrap dashboard rendering in try-catch to prevent crashes:

```typescript
private renderDashboard(): void {
  try {
    // Build dashboard string
    const output = this.buildDashboardOutput();
    logUpdate(output);
  } catch (error) {
    // Fallback to basic spinner on render failure
    this.logger.error({ error }, 'Dashboard render failed, falling back to spinner');
    if (!this.spinner) {
      this.spinner = ora('Processing...').start();
    }
  }
}
```

**Event Log Persistence**: Event buffer must persist across phase transitions (import → processing → complete). Store in ProgressHandler instance state, not reset between phases.
