# OpenTelemetry Migration Plan

## Overview

Migrate from custom `InstrumentationCollector` to industry-standard OpenTelemetry for HTTP metrics and operational telemetry. Create new `@exitbook/telemetry` package with minimal custom code (~390 lines), keeping 95% standard Otel patterns.
Introduce a separate `@exitbook/events` package for CLI/UI event delivery (purist separation).

## Goals

- **Minimal custom code** - Use standard OpenTelemetry APIs; only custom code is CLI metrics exporter and event bus
- **Web-ready** - AsyncLocalStorage-based context propagation (no global state issues)
- **Preserve UX** - Keep existing CLI metrics table display format
- **Industry standard** - Follow OpenTelemetry semantic conventions and patterns
- **Non-breaking migration** - Dual support during transition, cleanup after

## Design Invariants

**Critical:** Telemetry must never change business behavior. If telemetry fails, the application must still function correctly. Telemetry is observational infrastructure, not authoritative state.
**Critical:** CLI must keep machine-readable output clean. Write progress/live logs to stderr, and command output (CSV/JSON/text) to stdout.
**Critical:** Event types are owned by the feature packages that emit them (no central event schema).

## Architectural Principles

These principles prevent common OpenTelemetry misuse patterns:

### 1. Spans Are Not Your Event System

**❌ Don't:** Use spans to drive application behavior
**✅ Do:** Use spans for telemetry, events for behavior

```typescript
// ❌ Bad - UI coupled to span internals
spanProcessor.onEnd((span) => {
  if (span.name.includes('import')) {
    updateProgressBar(); // Brittle!
  }
});

// ✅ Good - Explicit events, typed contract
eventBus.emit({ type: 'import.batch', totalImported: 1000, estimatedTotal: 5000 });
span.addEvent('import.batch', { totalImported: 1000, estimatedTotal: 5000 }); // Optional for tracing
eventBus.subscribe((event) => {
  if (event.type === 'import.batch') {
    updateProgressBar(event.totalImported);
  }
});
```

### 2. Make Event Semantics Explicit

**❌ Don't:** Infer behavior from span attributes or names
**✅ Do:** Emit explicit events with typed contracts (and optionally mirror to spans)

```typescript
// ❌ Bad - Implicit, refactor-unsafe
span.setAttribute('totalImported', 1000);
// How do consumers know when this changes?

// ✅ Good - Explicit event emission
eventBus.emit({
  type: 'import.batch',
  totalImported: 1000,
  estimatedTotal: 5000,
});
span.addEvent('import.batch', { totalImported: 1000, estimatedTotal: 5000 }); // Optional for tracing
```

### 3. Aggregate Metrics Eagerly

**❌ Don't:** Store unbounded snapshots
**✅ Do:** Aggregate during export

```typescript
// ❌ Bad - memory leak
this.snapshots.push(metric); // Grows forever

// ✅ Good - constant memory
this.summary.accumulate(metric); // Update in-place
```

### 4. Use Metrics for Performance, Events for Behavior

| Metrics               | Events                 |
| --------------------- | ---------------------- |
| HTTP request duration | Provider failover      |
| Request count         | Batch processed        |
| Error rate            | Import completed       |
| Response size         | Circuit breaker opened |

### 5. Always End Spans

**❌ Don't:** Leave spans open across async boundaries
**✅ Do:** Use `withSpan()` or manually call `span.end()`

```typescript
// ❌ Bad - context leak
const span = tracer.startSpan('import');
setTimeout(() => doWork(), 1000); // Span leaks into timer

// ✅ Good - span ends before async boundary
await withSpan('import', async (span) => {
  await doWork(); // Span ends when promise resolves
});
```

## Current State

**Custom instrumentation system:**

- `InstrumentationCollector` class with in-memory `RequestMetric[]` array
- Constructor injection: CLI → ProviderManager → HttpClient
- Records: provider, service, endpoint (sanitized), method, status, duration, errors
- CLI displays ASCII table summaries via `getSummary()` after operations
- Used by ~30 provider API clients (blockchain, exchange, price)

**Data flow:**

```
CLI creates InstrumentationCollector
  ↓
ProviderManager.setInstrumentation(collector)
  ↓
Providers created with instrumentation in config
  ↓
HttpClient.recordMetric() calls collector.record()
  ↓
CLI calls getSummary() and displays formatted table
```

## New Package: `@exitbook/telemetry`

### Structure

```
packages/telemetry/
├── src/
│   ├── index.ts                              # Public API (re-exports + helpers)
│   ├── setup.ts                              # SDK initialization (~80 lines)
│   ├── context.ts                            # Context helpers (~30 lines)
│   ├── exporters/
│   │   ├── in-memory-metrics-exporter.ts    # CLI metrics collector (~120 lines)
│   │   └── types.ts                         # MetricsSummary interface
│   └── instrumentation/
│       └── http-instrumentation.ts          # HTTP metrics recording (~80 lines)
├── package.json
└── tsconfig.json
```

## New Package: `@exitbook/events`

```
packages/events/
├── src/
│   ├── index.ts                              # Public API
│   └── event-bus.ts                          # Async event bus (~60 lines)
├── package.json
└── tsconfig.json
```

### Dependencies

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.x",
    "@opentelemetry/sdk-node": "^0.x",
    "@opentelemetry/sdk-metrics": "^1.x",
    "@opentelemetry/sdk-trace-base": "^1.x",
    "@opentelemetry/context-async-hooks": "^1.x",
    "@opentelemetry/semantic-conventions": "^1.x",
    "@opentelemetry/resources": "^1.x"
  },
  "pnpm": {
    "overrides": {
      "@opentelemetry/*": "SAME_VERSION"
    }
  }
}
```

**Important:** Pin all `@opentelemetry/*` packages to the same release line via overrides (or exact versions) to avoid compatibility issues.

### Public API

```typescript
// Standard Otel re-exports
export { trace, metrics, context, Span } from '@opentelemetry/api';

// Setup
export { initializeTelemetry, shutdownTelemetry, flushTelemetry } from './setup.js';
export type { TelemetryConfig } from './setup.js';

// Custom exporters (CLI)
export { InMemoryMetricsExporter } from './exporters/in-memory-metrics-exporter.js';
export type { MetricsSummary, EndpointMetrics } from './exporters/types.js';

// HTTP instrumentation
export { createHttpMetrics, recordHttpRequest, sanitizeEndpoint } from './instrumentation/http-instrumentation.js';
export type { HttpMetrics } from './instrumentation/http-instrumentation.js';

// Context helpers (convenience + logger correlation)
export { withSpan, getCurrentSpan, getTraceId, getSpanId } from './context.js';
```

### Public API (`@exitbook/events`)

```typescript
export { EventBus } from './event-bus.js';
```

## Migration Strategy

### Phase 1: Create Foundation (No Breaking Changes)

**1. Create `@exitbook/telemetry` package**

Files to create:

- `packages/telemetry/package.json` - Dependencies (includes NodeSDK, context-async-hooks)
- `packages/telemetry/src/setup.ts` - `initializeTelemetry()` configures both MeterProvider + TracerProvider
- `packages/telemetry/src/context.ts` - `withSpan()`, `getCurrentSpan()`, `getTraceId()`, `getSpanId()`
- `packages/telemetry/src/exporters/in-memory-metrics-exporter.ts` - Custom MetricExporter for CLI summaries
- `packages/telemetry/src/exporters/types.ts` - `MetricsSummary`, `EndpointMetrics` interfaces (from current instrumentation.ts)
- `packages/telemetry/src/instrumentation/http-instrumentation.ts` - `createHttpMetrics()`, `recordHttpRequest()`, `sanitizeEndpoint()` (move from http package)
- `packages/telemetry/src/index.ts` - Re-exports

**2. Create `@exitbook/events` package**

Files to create:

- `packages/events/package.json` - Minimal dependencies
- `packages/events/src/event-bus.ts` - `EventBus` implementation (async delivery)
- `packages/events/src/index.ts` - Re-exports

**Key implementation details:**

**`setup.ts`** - Uses NodeSDK to configure both metrics and traces:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor, MultiSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { SpanProcessor, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { MetricExporter } from '@opentelemetry/sdk-metrics';

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion?: string;
  enabled?: boolean;
  metricExporter?: MetricExporter;
  spanExporter?: SpanExporter;
  spanProcessor?: SpanProcessor; // Optional custom processor (e.g., trace exporter plumbing)
  exportIntervalMs?: number;
}

let sdk: NodeSDK | undefined;

let metricReader: PeriodicExportingMetricReader | undefined;

export async function initializeTelemetry(config: TelemetryConfig): Promise<NodeSDK | undefined> {
  if (!config.enabled) return undefined;

  metricReader = config.metricExporter
    ? new PeriodicExportingMetricReader({
        exporter: config.metricExporter,
        exportIntervalMillis: config.exportIntervalMs ?? 1000,
      })
    : undefined;

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
      ...(config.serviceVersion ? { [ATTR_SERVICE_VERSION]: config.serviceVersion } : {}),
    }),

    // Context propagation for async calls
    contextManager: new AsyncHooksContextManager().enable(),

    // Metrics
    metricReader,

    // Traces - optional export
    spanProcessor: (() => {
      const processors: SpanProcessor[] = [];
      if (config.spanProcessor) {
        processors.push(config.spanProcessor);
      }
      if (config.spanExporter) {
        processors.push(new BatchSpanProcessor(config.spanExporter));
      }
      if (processors.length === 0) return undefined;
      if (processors.length === 1) return processors[0];
      return new MultiSpanProcessor(processors);
    })(),
  });

  await sdk.start();
  return sdk;
}

export async function flushTelemetry(): Promise<void> {
  if (metricReader) {
    await metricReader.forceFlush();
  }
  await sdk?.forceFlush();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = undefined;
  }
  metricReader = undefined;
}
```

**`context.ts`** - Add `getSpanId()` for logger correlation:

```typescript
import { trace, context as otelContext } from '@opentelemetry/api';

export function getTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}

export function getSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().spanId;
}
```

**`packages/events/src/event-bus.ts`** - Internal event bus (decouples UI from telemetry):

Feature packages define their own event types (e.g., `ImportEvent`, `ProviderEvent`).
The event bus stays generic and does not centralize event schemas.

```typescript
type EventHandler<TEvent> = (event: TEvent) => void;

/**
 * Simple event bus for business events.
 * Decouples UI behavior from telemetry.
 */
export class EventBus<TEvent> {
  private handlers: EventHandler<TEvent>[] = [];
  private queue: TEvent[] = [];
  private flushing = false;

  constructor(private onError: (err: unknown) => void) {}

  subscribe(handler: EventHandler<TEvent>): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  emit(event: TEvent): void {
    this.queue.push(event);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        for (const handler of this.handlers) {
          try {
            handler(event);
          } catch (err) {
            // Never let event handler failures crash telemetry
            this.onError(err);
          }
        }
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }
}
```

**Why this architecture is better:**

- **Separation of concerns:** Spans are telemetry artifacts, events are business behavior
- **Ordered delivery:** Events are delivered in emit order, but asynchronously (microtask flush)
- **Testability:** Can test event handlers without OpenTelemetry
- **Explicit contract:** Each feature defines its own event type
- **Non-blocking:** Event delivery is async to avoid adding latency to imports
- **Refactor-safe:** Change telemetry backend without breaking UI

**Important:** Telemetry events are delivered asynchronously and may lag slightly under heavy load.
Ordering is preserved within the event queue, but delivery is not synchronous.
Use the event bus only for UI/UX and logging, never for business behavior.
If volume is high (e.g., per-request events), add throttling or sampling at the emitter.

**How to emit events from business code:**

```typescript
// In importer code - emit explicit events to event bus (live UI)
eventBus.emit({
  type: 'import.batch',
  totalImported: 1000,
  estimatedTotal: 5000,
});

// Optional: also mirror into spans for tracing/observability
span.addEvent('import.batch', { totalImported: 1000, estimatedTotal: 5000 });

// UI subscribes to event bus, not spans
```

**Event taxonomy (initial):**

- Ingestion owns: `import.batch`, `import.completed` (progress updates)
- Providers own: `provider.request.started|succeeded|failed` (request lifecycle)
- Providers own: `provider.rate_limited`, `provider.backoff`, `provider.circuit_open` (resilience)
- Providers own: `provider.failover` (routing decisions)

**2. Update `@exitbook/logger` for trace correlation**

Modify `packages/logger/src/logger.ts` to add traceId/spanId to all logs:

```typescript
import pino from 'pino';
import type { Logger } from 'pino';
import { createRequire } from 'node:module';

// Lazy-loaded telemetry functions
let getTraceId: (() => string | undefined) | undefined;
let getSpanId: (() => string | undefined) | undefined;
let telemetryLoadAttempted = false;

function ensureTelemetryLoaded(logger: Logger): void {
  if (telemetryLoadAttempted) return;
  telemetryLoadAttempted = true;

  try {
    // Dynamic import inside function (not top-level)
    // Works with both ESM and CJS
    let requireFn: NodeRequire;
    try {
      requireFn = createRequire(import.meta.url);
    } catch {
      requireFn = require;
    }

    const telemetry = requireFn('@exitbook/telemetry');
    getTraceId = telemetry.getTraceId;
    getSpanId = telemetry.getSpanId;
  } catch (err) {
    // Only warn if telemetry is expected to be enabled
    if (process.env.TELEMETRY_ENABLED === '1') {
      logger.warn({ err }, 'Telemetry package not available - trace correlation disabled');
    }
  }
}

export function getLogger(component: string): Logger {
  const base = pino({
    name: component,
    mixin() {
      const traceId = getTraceId?.();
      const spanId = getSpanId?.();
      return traceId ? { traceId, spanId } : {};
    },
  });

  // Attempt to load telemetry on first logger creation
  ensureTelemetryLoaded(base);

  return base;
}
```

**Why this works:**

- Dynamic `require()` inside function (not top-level await) - works with both ESM/CJS
- Logs warning on import failure (no silent errors)
- Cached attempt prevents repeated failures
- Uses pino `mixin` for automatic trace context injection
- Graceful degradation if telemetry unavailable

**Example output:**

```json
{ "level": 30, "traceId": "a1b2c3d4...", "spanId": "e5f6g7h8...", "msg": "Import started" }
```

**3. Update `@exitbook/http` for dual support**

Modify `packages/http/src/types.ts`:

```typescript
import type { InstrumentationCollector } from './instrumentation.js';
import type { HttpMetrics } from '@exitbook/telemetry';

export interface HttpClientConfig {
  // ... existing fields
  instrumentation?: InstrumentationCollector | undefined; // Keep temporarily
  telemetry?: HttpMetrics | undefined; // Add new
}
```

Modify `packages/http/src/client.ts`:

```typescript
import { recordHttpRequest } from '@exitbook/telemetry';

private recordMetric(...): void {
  // Legacy path (Phase 1-3)
  if (this.config.instrumentation && this.config.service) {
    this.config.instrumentation.record({ /* ... */ });
  }

  // New path
  if (this.config.telemetry && this.config.service) {
    recordHttpRequest({
      metrics: this.config.telemetry,
      provider: this.config.providerName,
      service: this.config.service,
      endpoint,
      method,
      status,
      durationMs: this.effects.now() - startTime,
      error,
    });
  }
}
```

### Phase 2: Update Provider Packages (Parallel)

**4. Update blockchain providers**

Modify `packages/blockchain-providers/src/core/types/index.ts`:

```typescript
import type { HttpMetrics } from '@exitbook/telemetry';

export interface ProviderConfig {
  // ... existing fields
  telemetry?: HttpMetrics | undefined; // Add
}
```

Modify `packages/blockchain-providers/src/core/provider-manager.ts`:

```typescript
import type { HttpMetrics } from '@exitbook/telemetry';

export class BlockchainProviderManager {
  private httpMetrics?: HttpMetrics;

  setTelemetry(metrics: HttpMetrics): void {
    this.httpMetrics = metrics;
  }

  // Pass to providers when creating
  private createProviderInstance(...): IBlockchainProvider {
    return ProviderRegistry.create(blockchain, providerName, {
      ...config,
      telemetry: this.httpMetrics,
    });
  }
}
```

Modify `packages/blockchain-providers/src/core/base/api-client.ts`:

```typescript
export abstract class BaseApiClient {
  constructor(config: ProviderConfig) {
    this.httpClient = new HttpClient({
      // ... existing config
      telemetry: config.telemetry, // Pass through
    });
  }
}
```

**5. Update price providers**

Modify `packages/price-providers/src/core/utils.ts`:

```typescript
import type { HttpMetrics } from '@exitbook/telemetry';

export interface ProviderHttpClientConfig {
  // ... existing fields
  telemetry?: HttpMetrics; // Add
}

export function createProviderHttpClient(config: ProviderHttpClientConfig): HttpClient {
  return new HttpClient({
    // ... existing config
    telemetry: config.telemetry,
  });
}
```

Update all provider factories (7 files):

- `packages/price-providers/src/providers/coingecko/provider.ts`
- `packages/price-providers/src/providers/binance/provider.ts`
- `packages/price-providers/src/providers/bank-of-canada/provider.ts`
- `packages/price-providers/src/providers/frankfurter/provider.ts`
- `packages/price-providers/src/providers/cryptocompare/provider.ts`
- `packages/price-providers/src/providers/ecb/provider.ts`

Add `telemetry?: HttpMetrics` parameter to factory functions, pass to `createProviderHttpClient()`.

**6. Update exchange providers** (same pattern as price providers)

### Phase 3: Update CLI Integration

**7. Update CLI commands**

Modify `apps/cli/src/features/import/import.ts`:

```typescript
import {
  initializeTelemetry,
  shutdownTelemetry,
  flushTelemetry,
  InMemoryMetricsExporter,
  createHttpMetrics,
} from '@exitbook/telemetry';
import { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import { ProgressHandler } from '../../ui/progress-handler.js';
import type { ImportEvent } from '@exitbook/ingestion';
import type { ProviderEvent } from '@exitbook/blockchain-providers';

type CliEvent = ImportEvent | ProviderEvent;

async function executeImportCommand(rawOptions: unknown): Promise<void> {
  const logger = getLogger('cli.import');

  // Create event bus (business events, not telemetry)
  const eventBus = new EventBus<CliEvent>((err) => {
    logger.warn({ err }, 'Telemetry event handler error');
  });

  // Subscribe UI to event bus
  const progressHandler = new ProgressHandler();
  const unsubscribe = eventBus.subscribe((event) => {
    progressHandler.handleEvent(event);
  });

  // Initialize telemetry with metrics and traces
  const metricsExporter = new InMemoryMetricsExporter();
  const sdk = await initializeTelemetry({
    serviceName: 'exitbook-cli',
    enabled: true,
    metricExporter: metricsExporter,
    exportIntervalMs: 1000,
  });

  const httpMetrics = createHttpMetrics();

  try {
    const providerManager = new BlockchainProviderManager();
    providerManager.setTelemetry(httpMetrics);

    // ... execute import (emits eventBus events and optional span events)

    // Ensure final export before reading metrics summary
    await flushTelemetry();

    // Get summary (same interface as before!)
    const instrumentationSummary = metricsExporter.getSummary();

    // Display table (UNCHANGED)
    if (output.isTextMode() && instrumentationSummary.total > 0) {
      displayApiCallSummary(instrumentationSummary, output);
    }
  } finally {
    unsubscribe();
    progressHandler.cleanup();
    await shutdownTelemetry();
  }
}

// displayApiCallSummary() - NO CHANGES, same MetricsSummary interface

// Logs now automatically include traceId/spanId from trace context!
// Example: logger.info('Import started') → {"level":30,"traceId":"...","msg":"Import started"}
```

**ProgressHandler implementation** (`apps/cli/src/ui/progress-handler.ts`):

```typescript
import cliProgress from 'cli-progress';
import type { ImportEvent } from '@exitbook/ingestion';
import type { ProviderEvent } from '@exitbook/blockchain-providers';

type CliEvent = ImportEvent | ProviderEvent;

export class ProgressHandler {
  private progressBar?: cliProgress.SingleBar;
  private counterBar?: cliProgress.SingleBar;
  private currentTotal = 0;
  private hasKnownTotal = false;

  constructor() {
    this.progressBar = new cliProgress.SingleBar({
      format: 'Progress | {bar} | {value}/{total} transactions',
    });
    this.counterBar = new cliProgress.SingleBar({
      format: 'Imported | {value} tx',
    });
  }

  handleEvent(event: CliEvent): void {
    switch (event.type) {
      case 'import.batch':
        this.currentTotal = event.totalImported;
        if (event.estimatedTotal !== undefined) {
          if (this.counterBar?.isActive) {
            this.counterBar.stop();
          }
          if (!this.progressBar.isActive) {
            this.progressBar.start(event.estimatedTotal, this.currentTotal);
          }
          this.hasKnownTotal = true;
          this.progressBar.update(this.currentTotal);
        } else {
          if (this.progressBar.isActive) {
            this.progressBar.stop();
          }
          this.hasKnownTotal = false;
          if (!this.counterBar?.isActive) {
            this.counterBar?.start(1, this.currentTotal);
          }
          this.counterBar?.update(this.currentTotal);
        }
        break;

      case 'provider.failover':
        this.logAboveProgress(`⚠ Provider failover: ${event.from} → ${event.to}`);
        break;

      case 'import.completed':
        if (this.progressBar.isActive) this.progressBar.stop();
        if (this.counterBar?.isActive) this.counterBar.stop();
        this.logLine(`✓ Import completed: ${event.total} transactions`);
        break;
    }
  }

  private logAboveProgress(message: string): void {
    if (this.progressBar?.isActive || this.counterBar?.isActive) {
      const current = this.currentTotal;
      const total = this.hasKnownTotal ? this.progressBar.getTotal() : 1;
      this.progressBar?.stop();
      this.counterBar?.stop();
      this.logLine(message);
      if (this.hasKnownTotal) {
        this.progressBar?.start(total, current);
      } else {
        this.counterBar?.start(1, current);
      }
      return;
    }

    this.logLine(message);
  }

  private logLine(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  cleanup(): void {
    if (this.progressBar?.isActive) {
      this.progressBar.stop();
    }
  }
}
```

**Benefits of typed events:**

- Compile-time safety (TypeScript catches invalid event data)
- Refactor-safe (rename fields, IDE finds all usages)
- Self-documenting (events are explicit, not inferred)
- Testable (can create events without spans)
- Avoids UX lies: unknown totals use a counter until a real total is known
- Keeps CLI output clean by pausing the bar before logging

Modify `apps/cli/src/features/prices/prices-handler.ts` (same pattern).

**Example: Emitting events from importer code:**

```typescript
import { withSpan } from '@exitbook/telemetry';
import type { EventBus } from '@exitbook/events';
import type { ImportEvent } from '@exitbook/ingestion';
import type { ProviderEvent } from '@exitbook/blockchain-providers';

type CliEvent = ImportEvent | ProviderEvent;

async function importTransactions(address: string, eventBus: EventBus<CliEvent>): Promise<Result<void, Error>> {
  return withSpan('blockchain.import', async (span) => {
    span.setAttribute('blockchain', 'ethereum');
    span.setAttribute('address', address);

    let totalImported = 0;
    const estimatedTotal = 5000;

    for await (const batch of fetchBatches(address)) {
      // Process batch...
      totalImported += batch.length;

      // ✅ Emit explicit event - immediate UI update
      eventBus.emit({
        type: 'import.batch',
        totalImported,
        estimatedTotal,
      });

      // Optional mirror to tracing
      span.addEvent('import.batch', { totalImported, estimatedTotal });
    }

    // ✅ Emit completion event
    eventBus.emit({ type: 'import.completed', total: totalImported });
    span.addEvent('import.completed', { total: totalImported });

    return ok(undefined);
  });
}
```

**Key pattern:**

1. Wrap operation in `withSpan()` - auto-ends span
2. Emit to event bus for live UI updates
3. Optionally mirror to `span.addEvent()` for tracing
4. UI subscribes to event bus, not spans
5. Telemetry backend (if configured) receives spans with events

### Phase 4: Cleanup (Breaking Changes)

**8. Remove legacy instrumentation**

Delete:

- `packages/http/src/instrumentation.ts` (entire file)

Modify `packages/http/src/types.ts`:

```typescript
// Remove: import type { InstrumentationCollector }
export interface HttpClientConfig {
  // Remove: instrumentation?: InstrumentationCollector
  telemetry?: HttpMetrics | undefined; // Keep only this
}
```

Modify `packages/http/src/client.ts`:

```typescript
private recordMetric(...): void {
  if (!this.config.telemetry || !this.config.service) {
    return;
  }

  recordHttpRequest({ /* ... */ }); // Only new path
}
```

Remove `setInstrumentation()` methods from provider managers (only `setTelemetry()` remains).

## Critical Files

### Files to Create (Phase 1)

1. **`packages/events/src/event-bus.ts`** - Internal event bus (~60 lines)
   - `EventBus<T>` - Generic async pub/sub for UI decoupling
   - Prevents telemetry from driving business behavior
   - Keeps event ownership in feature packages

2. **`packages/telemetry/src/exporters/in-memory-metrics-exporter.ts`** - Core CLI component (~120 lines)
   - Implements OpenTelemetry `MetricExporter` interface
   - Aggregates metrics eagerly (constant memory, no snapshots)
   - `getSummary()` method returns pre-aggregated `MetricsSummary` format
   - Preserves CLI table display compatibility

3. **`packages/telemetry/src/instrumentation/http-instrumentation.ts`** - HTTP metrics recording (~80 lines)
   - `createHttpMetrics()` - Creates Otel histogram/counter instruments
   - `recordHttpRequest()` - Records metrics using semantic conventions
   - `sanitizeEndpoint()` - Moved from http package, strips API keys/addresses

4. **`packages/telemetry/src/setup.ts`** - SDK initialization (~80 lines)
   - `initializeTelemetry()` - Configures NodeSDK with MeterProvider + TracerProvider
   - Accepts metric exporter + optional span exporter
   - `shutdownTelemetry()` - Cleanup

5. **`packages/telemetry/src/context.ts`** - Context helpers (~30 lines)
   - `withSpan()` - Execute function in span context (auto-ends)
   - `getTraceId()`, `getSpanId()` - For logger correlation
   - Uses Otel's active span from context

### Files to Modify (Phase 1-3)

6. **`packages/logger/src/logger.ts`** - Logger with trace correlation
   - Add pino `mixin` to inject traceId/spanId automatically
   - Lazy import telemetry to avoid circular dependency
   - Graceful degradation if telemetry unavailable

7. **`packages/http/src/client.ts`** - Central HTTP client
   - Add dual support in `recordMetric()` method (lines 317-331)
   - Check both `instrumentation` and `telemetry` config
   - Single point affecting all ~30 provider clients

8. **`apps/cli/src/features/import/import.ts`** - Primary CLI entry point
   - Initialize telemetry with metrics exporter (and optional span exporter)
   - Create and pass httpMetrics to provider manager
   - Get summary and display table (lines 220, 350-408)
   - Reference implementation for other CLI commands

9. **`packages/blockchain-providers/src/core/provider-manager.ts`** - Provider lifecycle
   - Add `setTelemetry(HttpMetrics)` method
   - Pass metrics to providers during creation
   - Pattern replicated in PriceProviderManager

## Key Design Decisions

### 1. InMemoryMetricsExporter (Custom Component)

**Why custom:** OpenTelemetry's standard exporters send to external backends (Prometheus, OTLP). CLI needs synchronous in-process queries for table display.

**What it does:**

- Implements `MetricExporter` interface from `@opentelemetry/sdk-metrics`
- **Aggregates eagerly** during export (no snapshot storage)
- `getSummary()` returns pre-aggregated `MetricsSummary` format
- Preserves existing CLI UX with zero changes to display code
- Constant memory usage (no unbounded snapshot list)

**Implementation pattern:**

```typescript
export class InMemoryMetricsExporter implements MetricExporter {
  private summary: MetricsSummary = { endpoints: new Map(), total: 0 };

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    // Aggregate immediately, don't store snapshots
    for (const scopeMetrics of metrics.scopeMetrics) {
      for (const metric of scopeMetrics.metrics) {
        this.aggregateMetric(metric);
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  private aggregateMetric(metric: MetricData): void {
    // Extract endpoint, count, duration from metric
    // Update summary.endpoints map in-place
    // Increment summary.total
  }

  getSummary(): MetricsSummary {
    return this.summary; // Already aggregated
  }
}
```

**Benefits over snapshot storage:**

- O(1) memory instead of O(n) snapshots
- Faster summary retrieval (no aggregation loop)
- No memory leak risk for long-running operations
- Requires a final `sdk.forceFlush()` before reading summary to ensure latest metrics are exported

**Size:** ~120 lines (reduced from 150 by removing snapshot storage)

### 2. HTTP Instrumentation (Metrics Only)

**Follows OpenTelemetry semantic conventions:**

- Metric names: `http.client.request.duration`, `http.client.request.count`
- Attributes: `http.request.method`, `http.response.status_code`, `url.path`
- Custom attributes: `http.provider`, `service.type` (blockchain/exchange/price)

**Preserves privacy:**

- `sanitizeEndpoint()` strips Ethereum addresses, API keys, hex patterns
- Same regex patterns as current implementation
- Applied before recording metrics
- Avoid `url.full` or other high-cardinality fields in metrics. Use sanitized `url.path`
  or a normalized endpoint label to keep cardinality bounded.

**Metrics vs Events:**

| Use Metrics For                           | Use Events For                             |
| ----------------------------------------- | ------------------------------------------ |
| Performance data (duration, count)        | Lifecycle changes (failover, completion)   |
| Aggregatable data (avg, sum, percentiles) | Discrete business events (batch processed) |
| Statistical analysis                      | Progress tracking                          |
| Historical trends                         | Real-time UI updates                       |

**Example:**

```typescript
// ✅ Metric - performance data
recordHttpRequest({
  durationMs: 123,
  status: 200,
  endpoint: '/api/transactions',
});

// ✅ Event - business behavior
span.addEvent('provider.failover', {
  from: 'alchemy',
  to: 'infura',
  blockchain: 'ethereum',
});

// ❌ Don't infer events from metrics
// (e.g., don't detect failover by counting error metrics)
```

### 3. Context Propagation (Web-Ready)

**Uses AsyncLocalStorage:**

- Node.js built-in for async context isolation
- No global state issues in concurrent web requests
- `withSpan()` helper automatically propagates context
- Future-proof for web app deployment

**Example:**

```typescript
// Request A and Request B run concurrently - contexts isolated
app.post('/import', async (req, res) => {
  await withSpan('import', async (span) => {
    span.setAttribute('user', req.user.id);
    // Nested spans automatically have correct parent context
  });
});
```

### 4. Trace SDK Setup (Full Observability)

**Includes both metrics AND traces from day one:**

- NodeSDK configures MeterProvider (metrics) + TracerProvider (traces)
- `@opentelemetry/context-async-hooks` automatically propagates context
- EventBus enables real-time CLI progress events
- BatchSpanProcessor handles optional trace exporting for web backends

**Why include traces now:**

- Required for logger correlation (traceId/spanId in logs)
- Enables trace-based observability and correlation (progress still via event bus)
- Web app will need traces for distributed operations
- Minimal overhead - standard Otel pattern

**Context propagation:**

```typescript
// Spans automatically nest via AsyncLocalStorage
await withSpan('import', async (importSpan) => {
  await withSpan('fetch-batch', async (batchSpan) => {
    // batchSpan is child of importSpan automatically
    // All logs in this scope get same traceId
  });
});
```

**⚠️ AsyncLocalStorage Context Leak Prevention:**

AsyncLocalStorage can leak context if spans aren't ended properly. Follow these rules:

1. **Always end spans:** Use `withSpan()` helper (auto-ends) or manually call `span.end()`
2. **No spans across async boundaries:** Don't leave spans open when spawning child processes or worker threads
3. **Shutdown on exit:** Always `await shutdownTelemetry()` in CLI cleanup
4. **Avoid long-lived timers:** Timers can hold context references indefinitely
5. **Test for leaks:** In tests, verify `getActiveSpan()` returns undefined after operations complete

**Example - correct span lifecycle:**

```typescript
// ✅ Correct - span auto-ends
await withSpan('import', async (span) => {
  span.addEvent('import.batch', { totalImported: 1000 });
  // span.end() called automatically when async function completes
});

// ❌ Incorrect - span leaks across process boundary
const span = tracer.startSpan('import');
childProcess.fork('./worker.js'); // Context leaked to child
// span never ends

// ✅ Correct - end span before spawning
const span = tracer.startSpan('import');
span.end(); // Clean up first
childProcess.fork('./worker.js');
```

### 5. Logger Correlation (Automatic)

**Uses pino mixins for zero-touch integration:**

- Every log automatically includes `traceId` and `spanId` if available
- No code changes needed in importers/processors
- Graceful degradation if telemetry not initialized
- Jump from log → trace in observability UI (future)

**Example:**

```json
{ "level": 30, "traceId": "a1b2c3...", "spanId": "e5f6g7...", "provider": "kraken", "msg": "Import started" }
```

### 6. Dual Support During Migration

**Allows incremental rollout:**

- Both `instrumentation` and `telemetry` config fields exist
- HttpClient checks both, records to both if present
- Tests keep passing (can use `undefined` for both)
- Package-by-package migration (blockchain → price → exchange)
- Easy rollback if issues discovered

**Cleanup in Phase 4:**

- Remove `instrumentation` field entirely
- Delete `InstrumentationCollector` class
- Single code path for telemetry

## Verification Steps

### After Phase 1 (Package Creation)

```bash
# Build new package
cd packages/telemetry
pnpm build

# Run unit tests
pnpm test

# Verify exports
pnpm exec tsc --noEmit
```

### After Phase 3 (CLI Integration)

```bash
# Test import command with metrics
pnpm run dev import --exchange kraken --csv-dir ./test-data

# Verify ASCII table displays at end:
# ┌──────────┬──────────────────┬───────┬──────────────┐
# │ Provider │ Endpoint         │ Calls │ Avg Response │
# └──────────┴──────────────────┴───────┴──────────────┘

# Test JSON output format
pnpm run dev import --exchange kraken --csv-dir ./test-data --format json
# Verify runStats section contains metrics

# Test price enrichment
pnpm run dev prices enrich
# Verify metrics table shows CoinGecko/Binance/etc
```

### After Phase 4 (Cleanup)

```bash
# Full test suite
pnpm test

# E2E tests
pnpm test:e2e

# Build all packages
pnpm build

# Type check
pnpm exec tsc --build --force
```

## Rollback Plan

If issues discovered during Phase 2-3:

1. Revert CLI changes (use old InstrumentationCollector)
2. Keep telemetry package for future retry
3. Dual support allows gradual rollback package-by-package

## Future Extensions (Out of Scope)

After migration stable, consider:

1. **Trace exporters for web app**
   - Add OTLP exporter for Jaeger/Tempo/DataDog
   - Configure in web server startup (not CLI)
   - Visualize distributed traces in observability UI

2. **Span-based operation tracking**
   - Use `withSpan()` in import/price operations
   - Track provider failover as nested spans
   - Emit events: `span.addEvent('batch_processed', { count: 1000 })`
   - Export to observability backend for visual waterfall

3. **Enhanced CLI progress**
   - Spinner during blockchain scan phase
   - ETA calculation once total known
   - Multi-line progress for parallel imports

## Summary

**Custom code:** ~390 lines total

- InMemoryMetricsExporter: ~120 lines (reduced by eager aggregation)
- HTTP instrumentation: ~80 lines
- Setup helpers (NodeSDK): ~80 lines
- EventBus (`@exitbook/events`): ~60 lines (new - decouples UI from telemetry)
- Context helpers: ~30 lines
- Logger correlation: ~20 lines (pino mixin)

**Everything else:** Standard OpenTelemetry

**Benefits:**

- ✅ Industry-standard observability (metrics + traces)
- ✅ Live CLI progress (batch counts, provider failover) via event bus
- ✅ Web-ready (AsyncLocalStorage context propagation)
- ✅ Logger correlation (traceId in all logs)
- ✅ Preserves existing CLI UX (metrics table)
- ✅ Non-breaking migration path
- ✅ Minimal maintenance burden
- ✅ Future-proof for distributed tracing
- ✅ **Event bus decouples UI from telemetry**
- ✅ **Explicit event contracts prevent implicit coupling**
- ✅ **Eager aggregation prevents memory leaks**

**Risks:** Low

- Dual support prevents breaking changes
- Can rollback package-by-package
- CLI display format preserved via InMemoryMetricsExporter
- Tests keep passing throughout migration
- Logger gracefully degrades if telemetry unavailable
- Event bus adds ~60 lines but prevents architectural issues
- Telemetry never changes business behavior (observational only)
