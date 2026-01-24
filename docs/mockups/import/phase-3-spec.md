# Completion Summary Specification

## Overview

Static summary displayed when import + processing completes. Shows final stats and performance metrics. This is not a "phase" but rather final output after Phase 1 & 2 complete. Just aggregate data from previous events and display once.

## Completion Summary Mockup

```
EXITBOOK CLI  v2.1.0  |  Target: 0xd8da...9d7e  |  Session: #184
[✔ COMPLETED] ────────────────────────────────────────────────────────────────

[ RUN SUMMARY ]
Total Time:      14m 22s
Total Requests:  110,230 (High usage on: etherscan)

[ DATA RESULTS ]
Transactions:    152,640 imported
Processed:       152,640 (100%)
New Tokens:      45 discovered
Scams Detected:  1,204 rejected

Output saved to: ./data/transactions.db

──────────────────────────────────────────────────────────────────────────────
[ EVENTS ]
16:05:45  ✔  Processed group 0xce7e... (1 items)
16:12:34  ⚠  moralis: Rate limited, cooling down 54s
16:14:02  ✔  Processing completed
```

---

## Data Sources (All Exist)

### Run Summary Section

| Field               | Source                                                         | Calculation                                             |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Total Time          | `import.completed.durationMs` + `process.completed.durationMs` | Sum both phases, format as `mm:ss` or `Xm Ys`           |
| Total Requests      | `InstrumentationCollector.getSummary().total`                  | Total HTTP requests made                                |
| High usage provider | `InstrumentationCollector.getSummary().byProvider`             | Provider with most requests                             |
| Cost Estimate       | `InstrumentationCollector` metrics                             | Count requests by provider, apply rough cost multiplier |

**Cost Estimation Logic** (rough heuristic):

```typescript
// Example cost tiers (credits per 1k requests)
const costPerKRequests = {
  etherscan: 1.0, // Free tier, throttled
  alchemy: 2.0, // Paid tier
  moralis: 3.0, // Premium tier
  // etc.
};

const totalCredits = Object.entries(summary.byProvider).reduce((sum, [provider, count]) => {
  const costPer1k = costPerKRequests[provider] || 1.0;
  return sum + (count / 1000) * costPer1k;
}, 0);
```

**Note**: Cost estimate is optional and approximate. Can omit if too complex.

### Data Results Section

| Field                 | Source                                       | Notes                                                   |
| --------------------- | -------------------------------------------- | ------------------------------------------------------- |
| Transactions imported | `import.completed.totalImported`             | From import phase                                       |
| Processed count       | `process.completed.totalProcessed`           | From processing phase                                   |
| Processed percentage  | `(processed / imported * 100)`               | Should always be 100% on success                        |
| New Tokens            | Track from `metadata.batch.completed` events | Accumulate per-batch `cacheMisses` deltas from Phase 2  |
| Scams Detected        | Track from `scam.batch.summary` events       | Accumulate per-batch `scamsFound` counts from Phase 2   |
| Output path           | Static config                                | `EXITBOOK_DATA_DIR` or default `./data/transactions.db` |
| Event log             | Event buffer from ProgressHandler            | Shows last 3 events (persisted from earlier phases)     |

---

## Implementation Approach

### State Tracking in ProgressHandler

Add completion tracking:

```typescript
private completionStats = {
  importDurationMs: 0,
  processDurationMs: 0,
  totalImported: 0,
  totalProcessed: 0,
  newTokens: 0,      // Cumulative from metadata.batch.completed
  scamsDetected: 0,  // Cumulative from scam.batch.summary
};
```

### Capture Events

**Import completion:**

```typescript
case 'import.completed':
  this.completionStats.importDurationMs = event.durationMs;
  this.completionStats.totalImported = event.totalImported;
  break;
```

**Process completion:**

```typescript
case 'process.completed':
  this.completionStats.processDurationMs = event.durationMs;
  this.completionStats.totalProcessed = event.totalProcessed;
  // Trigger Phase 3 render
  this.renderCompletionSummary();
  break;
```

**Metadata/scam events** (already tracked in Phase 2):

```typescript
case 'metadata.batch.completed':
  // Events contain per-batch deltas, accumulate them
  this.metadataMetrics.totalHits += event.cacheHits;
  this.metadataMetrics.totalMisses += event.cacheMisses;
  // Also update completionStats for final summary
  this.completionStats.newTokens = this.metadataMetrics.totalMisses;
  break;

case 'scam.batch.summary':
  // Events contain per-batch counts, accumulate them
  this.scamMetrics.totalFound += event.scamsFound;
  this.completionStats.scamsDetected = this.scamMetrics.totalFound;
  break;
```

### Render Completion Summary

```typescript
private renderCompletionSummary(): void {
  const totalTimeMs =
    this.completionStats.importDurationMs +
    this.completionStats.processDurationMs;

  const totalTime = this.formatDuration(totalTimeMs);

  // Get instrumentation summary (if available)
  const summary = this.instrumentation?.getSummary();
  const totalRequests = summary?.total || 0;
  const topProvider = this.getTopProvider(summary);

  // Build summary text
  const output = `
EXITBOOK CLI  v${packageVersion}  |  Target: ${target}  |  Session: #${sessionId}
[✔ COMPLETED] ${'─'.repeat(60)}

[ RUN SUMMARY ]
Total Time:      ${totalTime}
Total Requests:  ${totalRequests.toLocaleString()}${topProvider ? ` (High usage on: ${topProvider})` : ''}

[ DATA RESULTS ]
Transactions:    ${this.completionStats.totalImported.toLocaleString()} imported
Processed:       ${this.completionStats.totalProcessed.toLocaleString()} (${this.getProcessedPercentage()}%)
New Tokens:      ${this.completionStats.newTokens} discovered
Scams Detected:  ${this.completionStats.scamsDetected} rejected

Output saved to: ${databasePath}
  `.trim();

  // Stop log-update, write final static output
  logUpdate.done();
  console.log(output);

  // Event log footer (persisted from earlier phases)
  this.renderEventLog();
}

private renderEventLog(): void {
  const separator = '─'.repeat(78);
  console.log(separator);
  console.log('[ EVENTS ]');

  // Show last 3 events from buffer
  const recentEvents = this.eventLog.slice(-3);
  for (const event of recentEvents) {
    console.log(event.formattedLine);
  }
}

private formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

private getTopProvider(summary?: MetricsSummary): string | null {
  if (!summary?.byProvider) return null;

  const entries = Object.entries(summary.byProvider);
  if (entries.length === 0) return null;

  const [topProvider] = entries.sort((a, b) => b[1] - a[1])[0];
  return topProvider;
}

private getProcessedPercentage(): string {
  if (this.completionStats.totalImported === 0) return '0';
  const pct = (this.completionStats.totalProcessed / this.completionStats.totalImported) * 100;
  return pct.toFixed(0);
}
```

---

## Design Decisions

### Cost Estimate: Optional

The mockup shows "Cost Estimate: ~150k credits" but this is complex:

- Different providers have different pricing models
- Pricing changes over time
- "Credits" is ambiguous (Alchemy credits? Moralis credits?)

**Recommendation**: Omit cost estimate initially. Just show "Total Requests" which is concrete and actionable.

If needed later, can add simple heuristic or link to provider dashboards for actual costs.

### Processed Percentage

Should always be 100% on successful completion. If < 100%, indicates errors during processing (should be caught earlier by `process.failed` event).

### New Tokens

Tracks metadata cache misses = tokens we had to fetch metadata for = "discovered" tokens. This is interesting for understanding data variety.

### Database Path

Show where data was saved. User can verify output location. Get from config or environment variable.

---

## Requirements

- Completion summary only renders after `process.completed` event
- Requires access to InstrumentationCollector for request stats
- Reuses state already tracked in Phase 1 & 2 (no new events needed)
- Must call `logUpdate.done()` before final output to stop dynamic updates
- Final output is static (no more updates after this)
- **Event log persistence**: Event buffer (`eventLog`) must be preserved throughout Phase 1 & 2, then displayed in completion summary
- Metadata/scam event counts are **accumulated from per-batch deltas**, not read as cumulative totals
