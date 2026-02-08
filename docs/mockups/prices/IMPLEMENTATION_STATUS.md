# Prices Enrich Ink UI - Implementation Status

## Completed: Phase 2 - Event System Migration ✅

### What Was Changed

Successfully migrated from callback-based progress tracking to event-based architecture (matching ingestion pattern).

#### 1. Created Event Types (`apps/cli/src/features/prices/events.ts`)

- `PriceEvent` union type with 4 event variants:
  - `stage.started` - Stage begins
  - `stage.completed` - Stage completes with results
  - `stage.failed` - Stage encounters error
  - `stage.progress` - Progress updates (market prices only)

#### 2. Updated `PricesEnrichHandler` (`prices-enrich-handler.ts`)

- **Removed:** `EnrichProgressCallbacks` interface and `callbacks` option
- **Added:** Optional `EventBus<PriceEvent>` parameter to constructor
- **Changed:** All 4 stages now emit events instead of callbacks:
  - Stage 1 (tradePrices): `stage.started` → `stage.completed`/`stage.failed`
  - Stage 2 (fxRates): `stage.started` → `stage.completed`/`stage.failed`
  - Stage 3 (marketPrices): `stage.started` → `stage.progress` → `stage.completed`/`stage.failed`
  - Stage 4 (propagation): `stage.started` → `stage.completed`/`stage.failed`

#### 3. Updated `PricesFetchHandler` (`prices-handler.ts`)

- **Added:** Optional `EventBus<PriceEvent>` parameter to constructor
- **Changed:** Progress reporting now emits `stage.progress` events
- **Fixed:** Progress emission timing (P2/P3/P2b issues):
  - Moved progress increment to end of transaction processing (after fail-fast check)
  - Removed duplicate emissions (now only emits at intervals and completion)
  - Added final progress emission before fail-fast break (captures partial work)
  - Progress: `processed % 50 === 0 || processed === total || breaking early`

#### 4. Cleaned Up Types (`prices-utils.ts`)

- **Removed:** `onMarketPricesProgress` callback from `PricesFetchCommandOptions`

### Event Flow Architecture

```
PricesEnrichHandler
  └─> eventBus.emit({ type: 'stage.started', stage: '...' })
  └─> PricesFetchHandler (for marketPrices stage)
      └─> eventBus.emit({ type: 'stage.progress', ... })
  └─> eventBus.emit({ type: 'stage.completed', result: {...} })
```

Listeners (future UI controller) subscribe to events and update state:

```typescript
eventBus.subscribe((event: PriceEvent) => {
  switch (event.type) {
    case 'stage.started': // Update UI spinner
    case 'stage.progress': // Update progress counter
    case 'stage.completed': // Show results
    case 'stage.failed': // Show error
  }
});
```

---

## Remaining Work

### P1: Wire EventBus into Command Execution ⚠️

**Issue:** `prices-enrich.ts` (line 151) creates handler without EventBus

```typescript
// Current (no events):
const handler = new PricesEnrichHandler(transactionRepo, linkRepo);

// Needed:
const eventBus = new EventBus<PriceEvent>((err) => logger.error({ err }, 'Event error'));
const handler = new PricesEnrichHandler(transactionRepo, linkRepo, eventBus);
```

**Impact:** Events are emitted but no UI updates occur (eventBus is undefined)

**Solution:** Create EventBus in command and wire into controller (Phase 3)

---

### P1: API Call Telemetry for Live Footer ⚠️

**Issue:** `PriceEvent` only has stage lifecycle events, not API metrics

**Analysis:**

- Price providers use `InstrumentationCollector` (HTTP package) to track API calls
- Blockchain providers emit `ProviderEvent` with request details
- Ingestion uses both `IngestionEvent` + `ProviderEvent` for UI

**Solution Options:**

1. **Polling Approach** (Recommended for Phase 3):
   - UI controller periodically reads `instrumentation.getMetrics()`
   - Simpler, matches how ingestion uses instrumentation
   - No need for per-request events in price domain

2. **Event Emission** (More complex, not needed):
   - Add HTTP middleware to emit events per request
   - Overkill since instrumentation already collects metrics

**Recommended Implementation:**

```typescript
// In prices-enrich-controller.ts (Phase 3):
private refreshTimer = setInterval(() => {
  const metrics = this.instrumentation.getMetrics();
  // Update API footer state from metrics
}, 250);
```

---

## Phase 3: Create Ink UI Components

Still TODO:

### State Management

- [ ] `prices-enrich-state.ts` - State shape (based on spec lines 416-482)
- [ ] `prices-enrich-updater.ts` - Pure functions to update state from events

### Components

- [ ] `prices-enrich-components.tsx`:
  - Stage components (TradesPricesStage, FxRatesStage, MarketPricesStage, PropagationStage)
  - PricesEnrichMonitor (main component)
- [ ] Shared ApiFooter integration (already created in Phase 1)

### Lifecycle

- [ ] `prices-enrich-controller.ts`:
  - Create EventBus
  - Subscribe to PriceEvent
  - Call updater on events
  - Render Ink UI
  - Pass instrumentation to ApiFooter
  - Stop and cleanup

### Integration

- [ ] Update `prices-enrich.ts`:
  - Remove spinner
  - Create controller with EventBus
  - Start UI before handler execution
  - Stop UI after completion

---

## Phase 4: Command Integration

- [ ] Remove `--on-missing prompt` option (decided in spec review)
- [ ] Replace spinner with Ink UI in `prices-enrich.ts`
- [ ] Wire controller lifecycle (start → execute → stop)

---

## Phase 5: Cleanup & Testing

- [ ] Delete `InteractiveFxRateProvider` and related files
- [ ] Update handler tests (remove callback tests, add event tests)
- [ ] Add Ink UI integration test
- [ ] Manual E2E testing
- [ ] Update documentation

---

## Design Decisions

### Why Events Over Callbacks?

1. **Consistency:** Matches ingestion pattern (IngestionEvent + ProviderEvent)
2. **Decoupling:** Handler doesn't know about UI, only emits events
3. **Testability:** Easy to test handler without UI, test UI without handler
4. **Flexibility:** Multiple listeners can subscribe (logging, metrics, UI)

### Why Not Add Request Events to PriceEvent?

Price providers already instrument HTTP via `InstrumentationCollector`. The UI can poll
metrics instead of listening to per-request events. This matches how ingestion uses
instrumentation and avoids event spam.

### Progress Emission Strategy

Emit every 50 transactions OR at completion to balance:

- **Too frequent:** Event queue overhead, excessive rerenders
- **Too infrequent:** Perceived UI lag on large datasets

---

## Files Changed

✅ Created:

- `apps/cli/src/features/prices/events.ts`
- `apps/cli/src/ui/shared/ApiFooter.tsx` (Phase 1)
- `apps/cli/src/ui/shared/api-stats-types.ts` (Phase 1)

✅ Modified:

- `apps/cli/src/features/prices/prices-enrich-handler.ts`
- `apps/cli/src/features/prices/prices-handler.ts`
- `apps/cli/src/features/prices/prices-utils.ts`
- `apps/cli/src/ui/ingestion-monitor/*` (Phase 1 - uses shared ApiFooter)

⏳ Pending (Phase 3-5):

- `apps/cli/src/ui/prices-enrich-monitor/prices-enrich-state.ts`
- `apps/cli/src/ui/prices-enrich-monitor/prices-enrich-updater.ts`
- `apps/cli/src/ui/prices-enrich-monitor/prices-enrich-components.tsx`
- `apps/cli/src/ui/prices-enrich-monitor/prices-enrich-controller.ts`
- `apps/cli/src/features/prices/prices-enrich.ts` (integration)

---

## Next Steps

1. **Immediate:** Review this status document
2. **Phase 3:** Create UI infrastructure (state, updater, components, controller)
3. **Phase 4:** Integrate into command (replace spinner with Ink UI)
4. **Phase 5:** Testing and cleanup
