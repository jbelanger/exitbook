# Event System Implementation

## Summary

Implemented a simple event-driven progress system to decouple business logic from CLI display, eliminating the need for log-based UI updates.

## What Was Built

### 1. `@exitbook/events` Package (~60 lines)

- **EventBus class**: Generic async event bus with error handling
- **Microtask-based delivery**: Preserves ordering, non-blocking
- **Type-safe subscriptions**: Returns unsubscribe function

**Key features:**

- No dependencies
- Error isolation (handler failures don't crash system)
- Ordered async delivery

### 2. Event Types

#### `packages/ingestion/src/events.ts`

- `ImportEvent`: import.started, import.batch, import.warning, import.completed, import.failed
- `ProcessEvent`: process.started, process.batch, process.completed, process.failed
- `IngestionEvent`: Union type for all ingestion events

#### `packages/blockchain-providers/src/events.ts`

- `ProviderEvent`: provider.request.\*, provider.failover, provider.rate_limited, provider.circuit_open, provider.backoff

### 3. Event Emission (ingestion package)

**Modified files:**

- `import-service.ts`: ImportExecutor now accepts optional EventBus and emits events at:
  - Import start (resuming or new)
  - Each batch processed
  - Warnings
  - Import completion/failure

- `import-orchestrator.ts`: Passes EventBus through to ImportExecutor

### 4. Progress Handler (`apps/cli/src/ui/progress-handler.ts`)

**Features:**

- Subscribes to event bus
- Writes to stderr (keeps stdout clean for command output)
- Throttles batch progress logs (500ms) to avoid spam
- Handles all event types with appropriate formatting
- Ignores noisy provider.request.\* events

**Output examples:**

```
→ Starting import from kraken (account 1)...
  transactions: +50 new, 0 skipped (total: 50, cursor: 50)
  ⚠ Provider failover: alchemy → infura (rate limit)
✓ Import completed: 150 imported, 5 skipped (2.3s)
→ Processing 150 raw transactions for account 1...
✓ Processing completed: 150 transactions (0.5s)
```

### 5. CLI Integration (`apps/cli/src/features/import/import.ts`)

**Changes:**

- Creates EventBus<CliEvent> (union of IngestionEvent | ProviderEvent)
- Creates ProgressHandler and subscribes to events
- Passes event bus to ImportOrchestrator
- Cleans up subscription on exit

## Benefits

1. **Decoupled**: Business logic doesn't know about CLI display
2. **Testable**: Can test event handlers without full import flow
3. **Type-safe**: TypeScript validates all event data
4. **No logs required**: Events replace logger.info() for progress tracking
5. **Clean output**: Progress goes to stderr, command output to stdout
6. **Simple**: ~200 lines total, zero external dependencies

## What's NOT Included (vs. full OpenTelemetry plan)

- ❌ OpenTelemetry SDK
- ❌ Metrics aggregation (kept existing InstrumentationCollector)
- ❌ Trace context propagation
- ❌ Logger correlation
- ❌ HTTP instrumentation changes
- ❌ Span-based telemetry

## Current Status

✅ Event bus implemented
✅ Event types defined
✅ Events emitted from import service
✅ Progress handler displays events
✅ CLI wired up
✅ All packages build successfully

## Next Steps (Optional)

1. **Remove spinner** - Events provide better progress than spinner
2. **Add process events** - Emit events from TransactionProcessService
3. **Add provider events** - Emit failover/rate-limit events from provider manager
4. **Enhance display** - Add progress bars using event data
5. **JSON mode** - Events could be serialized for machine-readable output

## Testing

To test the event system:

```bash
# Run an import and watch stderr for progress events
pnpm run dev import --exchange kraken --csv-dir ./test-data

# Events will appear as:
# → Starting import from kraken (account 1)...
# transactions: +50 new, 0 skipped (total: 50, cursor: 50)
# ✓ Import completed: 150 imported, 5 skipped (2.3s)
```

## Architecture Notes

**Why event bus instead of callbacks?**

- Multiple subscribers possible (e.g., progress handler + telemetry)
- Easy to test (can mock event bus)
- Decouples event producers from consumers

**Why microtask delivery?**

- Non-blocking (doesn't slow down imports)
- Preserves ordering
- Simple to implement

**Why stderr for progress?**

- Keeps stdout clean for JSON/CSV output
- Standard Unix convention (command output → stdout, progress → stderr)
- Easy to pipe output: `exitbook import ... > output.json` (progress still visible)
