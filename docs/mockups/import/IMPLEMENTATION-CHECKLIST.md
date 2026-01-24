# Implementation Checklist

Quick reference for implementing the 3-phase telemetry dashboard.

## Pre-Implementation Changes

### 1. Add 'metadata' Service Type

**File**: `packages/http/src/instrumentation.ts`

```typescript
export interface RequestMetric {
  provider: string;
  service: 'blockchain' | 'exchange' | 'price' | 'metadata'; // Add 'metadata'
  endpoint: string;
  method: string;
  status: number;
  durationMs: number;
  timestamp: number;
  error?: string | undefined;
}
```

**Impact**: Any code that tags HTTP requests for token metadata must use `service: 'metadata'`.

### 2. Update Service Constructors (BREAKING)

**TokenMetadataService** (`packages/ingestion/src/features/token-metadata/token-metadata-service.ts`):

```typescript
constructor(
  private readonly tokenMetadataRepository: TokenMetadataRepository,
  private readonly providerManager: BlockchainProviderManager,
  private readonly eventBus: EventBus<IngestionEvent> // Add this (mandatory)
) {}
```

**ScamDetectionService** (`packages/ingestion/src/features/scam-detection/scam-detection-service.ts`):

```typescript
constructor(
  private readonly eventBus: EventBus<IngestionEvent> // Add this (mandatory)
) {}
```

**Call Sites to Update**:

- `apps/cli/src/features/import/import.ts:170` - TokenMetadataService
- `apps/cli/src/features/process/process.ts:98` - TokenMetadataService
- `packages/ingestion/src/features/process/process-service.ts:50` - ScamDetectionService
- Test files (see grep results)

---

## Phase 1/2: Import Dashboard

### New Event Types

**File**: `packages/ingestion/src/events.ts`

No new events needed - uses existing ImportEvent + ProviderEvent.

### ProgressHandler Changes

**File**: `apps/cli/src/ui/progress-handler.ts`

**Add constants**:

```typescript
const DASHBOARD_UPDATE_INTERVAL_MS = 250;
```

**Add state**:

```typescript
private velocityTracker = new VelocityTracker();
private providerStates = new Map<string, ProviderState>();
private instrumentation?: InstrumentationCollector;
private eventLog: EventLogEntry[] = []; // Persists across phases
```

**Add utilities**:

- `VelocityTracker` - Calculate req/s from instrumentation metrics
- `ProviderStateAggregator` - Build provider table rows

**Add rendering**:

- `renderImportDashboard()` - Build Phase 1 UI with log-update
- Error boundary wrapper (try-catch around rendering)

### Testing

- Import with high velocity (>100 req/s) - verify `!` indicator
- Provider rate limit - verify countdown timer
- Event log - verify last 3 events shown
- CSV import (no providers) - verify empty state handling

---

## Phase 2/2: Processing Dashboard

### New Event Types

**File**: `packages/ingestion/src/events.ts`

```typescript
export type TokenMetadataEvent =
  | {
      type: 'metadata.batch.completed';
      blockchain: string;
      batchNumber: number;
      cacheHits: number; // Per-batch delta (ProgressHandler accumulates)
      cacheMisses: number; // Per-batch delta (ProgressHandler accumulates)
      durationMs: number;
    };

export type ScamDetectionEvent =
  | {
      type: 'scam.batch.summary';
      blockchain: string;
      batchNumber: number;
      totalScanned: number;
      scamsFound: number;
      exampleSymbols: string[]; // First 3
    };

// Extend ProcessEvent
export type ProcessEvent =
  | ... // existing
  | {
      type: 'process.batch.started';
      accountId: number;
      batchNumber: number;
      batchSize: number;
      pendingCount: number;
    }
  | {
      type: 'process.batch.completed';
      accountId: number;
      batchNumber: number;
      batchSize: number;
      durationMs: number;
      pendingCount: number;
    }
  | {
      type: 'process.group.processing';
      accountId: number;
      groupId: string;     // Transaction hash OR exchange trade ID
      groupType: 'transaction' | 'trade';  // Source type
      itemCount: number;
    };

export type IngestionEvent =
  | ImportEvent
  | ProcessEvent
  | TokenMetadataEvent
  | ScamDetectionEvent;
```

### Emit Events From Services

**TokenMetadataService**:

- Track per-batch cache stats (reset counter each batch)
- Emit `metadata.batch.completed` with **per-batch deltas** after each batch
- ProgressHandler accumulates these deltas for overall stats

**ScamDetectionService**:

- Track scams per batch (internal counter, reset each batch)
- Emit `scam.batch.summary` with **per-batch counts** after each batch
- Do NOT emit individual scam events (flood protection)
- ProgressHandler accumulates counts for overall stats

**ProcessService**:

- Query pending count once at start, track in memory
- Emit `process.batch.started` with pendingCount
- Emit `process.group.processing` with `groupId`, `groupType` ('transaction' or 'trade')
- Emit `process.batch.completed` with durationMs

### ProgressHandler Changes

**Add state**:

```typescript
private pipelineMetrics = {
  pendingCount: 0,
  batchNumber: 0,
  batchSize: 0,
  batchTimes: [] as number[],
};

private metadataMetrics = {
  totalHits: 0,
  totalMisses: 0,
};

private metadataProviderStates = new Map<string, ProviderState>();

private scamMetrics = {
  totalFound: 0,
  recentExamples: [] as string[],
};
```

**Add rendering**:

- `renderProcessingDashboard()` - Build Phase 2 UI
- Reuse provider table rendering, filter by `service: 'metadata'`

### Testing

- Process large batch - verify pipeline metrics update
- High cache hit rate - verify metadata providers show IDLE
- Scam detection - verify summary (not individual events)
- No metadata activity - verify empty state handling
- Exchange import - verify `groupType: 'trade'` in event log

---

## Completion Summary

### Event Handling

**File**: `apps/cli/src/ui/progress-handler.ts`

**Add state**:

```typescript
private completionStats = {
  importDurationMs: 0,
  processDurationMs: 0,
  totalImported: 0,
  totalProcessed: 0,
  newTokens: 0,
  scamsDetected: 0,
};
```

**Capture events**:

- `import.completed` → Store durationMs, totalImported
- `process.completed` → Store durationMs, totalProcessed → Trigger Phase 3 render
- Track cumulative metadata/scam stats from Phase 2

**Add rendering**:

- `renderCompletionSummary()` - Build static summary
- Call `logUpdate.done()` before final output
- Show instrumentation summary (total requests, top provider)

### Testing

- Full import + process run
- Verify final counts match (accumulated from per-batch deltas)
- Verify database path shown
- Verify event log shows last 3 events from earlier phases

---

## Cross-Cutting Concerns

### Error Boundaries

Wrap all dashboard rendering in try-catch:

```typescript
try {
  const output = this.buildDashboard();
  logUpdate(output);
} catch (error) {
  this.logger.error({ error }, 'Dashboard render failed');
  // Fallback to spinner
}
```

### Event Log Persistence

- Store event buffer in instance state (not reset between phases)
- Show last 3 events at all times
- Scroll from bottom (newest last)

### Update Interval

Use constant `DASHBOARD_UPDATE_INTERVAL_MS = 250` for all frame updates.

### Service Type Filtering

When filtering InstrumentationCollector metrics:

- Phase 1/2: `service === 'blockchain'`
- Phase 2/2: `service === 'metadata'`

### Empty State Handling

**Phase 1/2**:

- If instrumentation disabled: Show `"N/A (instrumentation disabled)"` in velocity section
- If no providers active: Show `"No providers active"` instead of empty table

**Phase 2/2**:

- If no metadata providers: Show `"No metadata providers active"`
- If `totalHits + totalMisses === 0`: Show `"No metadata fetched"` instead of `"0% hit rate"`
- If no scams found: Show `"Scams Found: None"` instead of `"0"`

### Event Counting Semantics

**Critical**: All metadata and scam events emit **per-batch deltas**, not cumulative totals.

- `metadata.batch.completed.cacheHits` = hits in this batch only
- `metadata.batch.completed.cacheMisses` = misses in this batch only
- `scam.batch.summary.scamsFound` = scams found in this batch only

ProgressHandler accumulates these with `+=` to track overall run statistics.

---

## Validation Checklist

- [ ] RequestMetric.service includes 'metadata'
- [ ] TokenMetadataService accepts eventBus (mandatory)
- [ ] ScamDetectionService accepts eventBus (mandatory)
- [ ] All call sites updated with eventBus
- [ ] New event types added to IngestionEvent union
- [ ] Event emissions added to services
- [ ] ProgressHandler tracks all metrics
- [ ] Error boundaries added
- [ ] Event log persists across phases
- [ ] Update interval constant defined
- [ ] Phase 1/2 dashboard renders
- [ ] Phase 2/2 dashboard renders
- [ ] Completion summary renders
- [ ] High velocity (>100 req/s) shows `!` indicator
- [ ] Rate limit countdown works
- [ ] Metadata provider filtering works
- [ ] Scam batch summaries work (no flood)
- [ ] Final summary shows correct totals (accumulated from deltas)
- [ ] Event log persists across all phases (shown in completion)
- [ ] Empty states handled correctly (CSV, no metadata, etc.)
- [ ] Exchange imports show `groupType: 'trade'` in logs
