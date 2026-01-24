# Phase 2: Processing Dashboard Specification

## Overview

Real-time dashboard during transaction processing showing pipeline health, bottlenecks, and data quality insights. Currently the CLI "hangs" during processing with minimal feedback - this dashboard makes the system observable.

## Current State vs Required State

### What Exists Now

**ProcessEvent types** (`packages/ingestion/src/events.ts`):

```typescript
-process.started - // { accountId, totalRaw }
  process.batch - // { accountId, batchProcessed, totalProcessed }
  process.completed - // { accountId, durationMs, errors, totalProcessed }
  process.failed -
  process.skipped;
```

**Problem**: These only give high-level counts. No visibility into:

- What's currently being processed
- Why processing is slow (metadata fetch? API rate limit?)
- Cache efficiency
- Data quality (scams detected)

---

## Phase 2 Mockup

```
[ PIPELINE HEALTH ]
BUFFER:     42,083 raw items waiting
BATCH:      #1701 (100 items)
AVG TIME:   1.2s per batch

[ METADATA PROVIDERS ]
┌──────────┬────────────┬─────────┬─────────┬──────────┐
│ PROVIDER │ STATUS     │ LATENCY │ REQ/S   │ THROTTLES│
├──────────┼────────────┼─────────┼─────────┼──────────┤
│ moralis  │ ⚠ WAIT 54s │ 2.1s    │ 0.8 req/s │ 3        │
│ alchemy  │ ⚪ IDLE     │ 1.2s    │ 0.0 req/s │ 0        │
└──────────┴────────────┴─────────┴─────────┴──────────┘

[ DATA INSIGHTS ]
Token Cache:  92% Hit Rate (235 cached / 21 fetched)
Scams Found:  14 "Silly", "Cancy"

──────────────────────────────────────────────────────────────────────────────
[ EVENTS ]
16:05:45  ✔  Processed group 0xce7e... (1 items)
16:05:46  ℹ  Batch #1701: 13 tokens cached, 2 fetched from API
16:05:47  ⚠  Batch #1701: 14 scams detected (Silly, Cancy, ...)
16:12:34  ⚠  moralis: Rate limited, cooling down 54s
```

---

## Required Events (To Add)

### 1. Token Metadata Events

**Purpose**: Show cache efficiency and provider health

```typescript
export type TokenMetadataEvent = {
  type: 'metadata.batch.completed';
  blockchain: string;
  batchNumber: number;
  cacheHits: number; // Found in cache (cumulative for run)
  cacheMisses: number; // Had to fetch from API (cumulative for run)
  durationMs: number;
};
```

**Emit from**: `packages/ingestion/src/features/token-metadata/token-metadata-service.ts`

**Why needed**:

- Shows cache hit rate (Data Insights section)
- Shows metadata fetch progress in event log

**Note**: Metadata provider health (Moralis, Alchemy) comes from existing HTTP instrumentation + provider events, reusing Phase 1 infrastructure

---

### 2. Scam Detection Events

**Purpose**: Show data quality insights

```typescript
export type ScamDetectionEvent = {
  type: 'scam.batch.summary';
  blockchain: string;
  batchNumber: number;
  totalScanned: number;
  scamsFound: number;
  exampleSymbols: string[]; // First 3 scam tokens found
};
```

**Emit from**: `packages/ingestion/src/features/scam-detection/scam-detection-service.ts`

**Why needed**:

- Shows scam detection working (Data Insights section)
- Helps user understand data being filtered

**Event Flood Protection**:

- ❌ Do NOT emit individual `scam.detected` events to event bus (Vitalik's wallet has thousands of scams)
- ✅ Only emit `scam.batch.summary` after each batch
- Individual scam detections can be logged internally, not broadcasted to CLI

---

### 3. Enhanced Process Events

**Purpose**: Show pipeline health metrics

```typescript
// Add to existing ProcessEvent union
export type ProcessEvent =
  | ... // existing events
  | {
      type: 'process.batch.started';
      accountId: number;
      batchNumber: number;
      batchSize: number;
      pendingCount: number;  // Items still waiting to process
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
      txHash: string;      // Transaction group being processed
      itemCount: number;   // How many raw items in this group
    };
```

**Emit from**: `packages/ingestion/src/features/process/process-service.ts`

**Why needed**:

- Shows buffer size (Pipeline Health section)
- Shows current batch number and size
- Calculates average batch time

---

## Data Sources by Section

### Pipeline Health

```
BUFFER:     42,083 raw items waiting  ← process.batch.started.pendingCount
BATCH:      #1701 (100 items)         ← process.batch.started.batchNumber, batchSize
AVG TIME:   1.2s per batch            ← Average of process.batch.completed.durationMs
```

### Metadata Providers (reuses Phase 1 infrastructure)

Same table structure as Phase 1 Import, but for metadata providers:

- Provider names: Moralis, Alchemy, etc. (from active metadata providers)
- Status: From `provider.rate_limited`, `provider.circuit_open` events
- Latency: From InstrumentationCollector (filter by metadata provider requests)
- Req/s: From InstrumentationCollector (metadata provider request velocity)
- Throttles: Count of `provider.rate_limited` events per provider

**Always visible** during Phase 2 (no conditional rendering):

- If cache hit rate is 100%, providers show as IDLE (acceptable)
- Avoids UI flicker from sections appearing/disappearing
- Consistent layout throughout processing

**Why valuable**: Shows failover opportunities (e.g., "Moralis rate limited but Alchemy idle - why no failover?")

### Data Insights

```
Token Cache:  92% Hit Rate (235 cached / 21 fetched)  ← metadata.batch.completed.{cacheHits, cacheMisses}
Scams Found:  14 "Silly", "Cancy"                      ← scam.batch.summary.{scamsFound, exampleSymbols}
```

### Event Log

**Show:**

- `process.group.processing` → "✔ Processed group 0xce7e... (1 items)"
- `metadata.batch.completed` → "ℹ Batch #1701: 13 tokens cached, 2 fetched from API"
- `scam.batch.summary` → "⚠ Batch #1701: 14 scams detected (Silly, Cancy, ...)"
- `provider.rate_limited` (metadata provider) → "⚠ moralis: Rate limited, cooling down 54s"

---

## Implementation Approach

### Step 1: Add Event Types

Add new event types to `packages/ingestion/src/events.ts`:

```typescript
export type TokenMetadataEvent = ...
export type ScamDetectionEvent = ...
// Extend ProcessEvent with new variants

export type IngestionEvent =
  | ImportEvent
  | ProcessEvent
  | TokenMetadataEvent
  | ScamDetectionEvent;
```

### Step 2: Inject Event Bus

Add event bus parameter to service constructors:

- `TokenMetadataService(repository, providerManager, eventBus?)`
- `ScamDetectionService(eventBus?)`

### Step 3: Emit Events from Services

**TokenMetadataService** (`packages/ingestion/src/features/token-metadata/token-metadata-service.ts`):

- Track cumulative cache stats: `{ totalHits: 0, totalMisses: 0 }`
- Emit `metadata.batch.started` in `enrichBatch()` / `getOrFetchBatch()`
- Emit `metadata.fetch.waiting` when rate limited (with countdown timer)
- Emit `metadata.batch.completed` with cumulative cache stats

**ScamDetectionService** (`packages/ingestion/src/features/scam-detection/scam-detection-service.ts`):

- Track scams found during batch processing (internal counter)
- Emit `scam.batch.summary` after each batch with count + examples
- Do NOT emit individual `scam.detected` events (event flood protection)

**ProcessService** (`packages/ingestion/src/features/process/process-service.ts`):

- At process start: query initial pending count once, store in memory
- Emit `process.batch.started` with calculated pendingCount (no DB query)
- Emit `process.group.processing` for each transaction group
- Emit `process.batch.completed` with durationMs
- Update: `pendingCount = initialTotal - totalProcessed` (in-memory calculation)

### Step 3: Update ProgressHandler

Extend `apps/cli/src/ui/progress-handler.ts` to handle new events:

- Track batch-level metrics (rolling average of batch times)
- Track metadata cache stats
- Track scam detection stats
- Show bottleneck box when waiting > 5s

### Step 4: Track Metrics in ProgressHandler

Add state tracking:

```typescript
private pipelineMetrics = {
  pendingCount: 0,
  batchNumber: 0,
  batchSize: 0,
  batchTimes: [] as number[], // Rolling window for avg calculation
};

private metadataMetrics = {
  totalHits: 0,
  totalMisses: 0,
};

private metadataProviderStates = new Map<string, ProviderState>(); // Reuse from Phase 1

private scamMetrics = {
  totalFound: 0,
  recentExamples: [] as string[],
};
```

### Step 5: Render Phase 2 Dashboard

Add `renderProcessingDashboard()` method to ProgressHandler that displays:

- Pipeline health section (from pipelineMetrics)
- Metadata providers table (reuse Phase 1 provider matrix rendering, filter for metadata providers)
- Data insights section (from metadataMetrics + scamMetrics)
- Event log (already exists, just add new event types)

---

## Design Decisions

1. **Event bus setup**: TokenMetadataService and ScamDetectionService need event bus injected via constructor

2. **Pending count tracking** (efficiency):
   - Query DB once at `process.started` to get initial count
   - Track in memory: `pendingCount = initialTotal - totalProcessed`
   - No per-batch DB queries (avoids overhead)

3. **Cache stats**: Cumulative for entire run
   - Shows overall cache efficiency (e.g., "92% hit rate")
   - More meaningful than per-batch fluctuations
   - Track running totals: `{ totalHits: 0, totalMisses: 0 }`

4. **Scam summary frequency**: Emit after every batch (not just at end)
   - Keeps UI updated in real-time
   - Shows data quality insights during processing

---

## Requirements

- Event bus must be passed to TokenMetadataService and ScamDetectionService constructors
- Processing service tracks pending count in memory (one DB query at start)
- ProgressHandler reuses Phase 1 provider matrix infrastructure for metadata providers
- Metadata provider events come from existing HTTP instrumentation (no new provider-specific events needed)
