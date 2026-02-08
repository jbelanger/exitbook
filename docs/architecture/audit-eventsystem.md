V2 Architecture Audit: Event Handling & Price Enrich Command

     Scope: Price enrich command implementation (feat/price_enrich branch) and broader event handling architecture

     Executive Summary

     Yes, the event handling is messy, but not in the way one might initially think. The individual pieces are well-designed (EventRelay,
     LifecycleBridge, EventBus), but the composition pattern creates significant structural duplication and type-level friction that will compound
     as more event-driven UIs are added. The current approach treats events as compile-time union types, forcing manual composition at every
     boundary, when they should be runtime-composable streams.

     ────────────────────────────────────────

     FINDINGS

     ────────────────────────────────────────

     1. Pattern Re-evaluation: Event Union Type Composition

     What exists:

     The codebase uses TypeScript union types to compose events from different packages:

     - /packages/ingestion/src/events.ts: Defines IngestionEvent = ImportEvent | ProcessEvent | TokenMetadataEvent | ScamDetectionEvent
     - /packages/blockchain-providers/src/events.ts: Defines ProviderEvent (8 event variants)
     - /packages/price-providers/src/events.ts: Defines PriceProviderEvent (2 event variants)
     - /apps/cli/src/features/prices/events.ts: Defines PriceEvent = PriceProviderEvent | [stage events]
     - /apps/cli/src/features/import/import-service-factory.ts:27: type CliEvent = IngestionEvent | ProviderEvent
     - /apps/cli/src/features/process/process-service-factory.ts:28: type CliEvent = IngestionEvent | ProviderEvent
     - /apps/cli/src/ui/ingestion-monitor/ingestion-monitor-updater.ts:14: Re-exports type CliEvent = IngestionEvent | ProviderEvent

     Each feature manually composes the event types it needs via union type aliases. The EventBus is generic over the union type: EventBus<TEvent>.

     Why it's a problem:

     1. Manual composition at every boundary: Each feature creates its own union type alias (type CliEvent = ...), leading to 3+ identical type
     definitions across the codebase for the same logical event stream
     2. Type narrowing in reducers is verbose: The 1000-line ingestion-monitor-updater.ts and 275-line prices-enrich-updater.ts both contain giant
     switch statements on event.type that TypeScript can't optimize
     3. No runtime event filtering: Subscribers receive ALL events in the union and must ignore irrelevant ones via switch cases. The ingestion
     monitor receives provider events it doesn't care about but must handle via exhaustive pattern matching
     4. Coupling at compile time: Adding a new event type to ProviderEvent requires recompiling every consumer, even if they don't use it
     5. Event relay pattern duplication: EventRelay class (34 lines) is duplicated conceptually across ingestion-monitor and prices-enrich
     controllers, but can't be shared because each uses a different TEvent type

     What V2 should do:

     Replace compile-time union types with runtime-composable event streams using a library designed for this purpose. Two options:

     Option A: Effect Streams (recommended)
     - Stream<A, E, R> provides typed, composable, filtered event streams
     - Built-in operators for filtering (Stream.filter), merging (Stream.merge), mapping
     - Type-safe error handling and context tracking (eliminating EventBus's onError callback)
     - No manual union type composition - streams compose naturally at runtime

     Option B: RxJS Observables
     - Mature, well-understood, smaller bundle size than Effect
     - Observable<T> with operators like filter(), merge(), map()
     - Requires separate error handling strategy (Effect's advantage)

     Needs coverage:
     ┌───────────────────────────────────────────────┬──────────────────────────┬──────────────────────────────────────────────────────────────────
     ─┐
     │              Current capability               │    Covered by Effect     │                               Notes
      │
     │                                               │         Streams?         │
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Type-safe event emission                      │ Yes                      │ Stream.make<PriceEvent>()
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Async delivery via microtask queue            │ Yes                      │ Stream.fromQueue() with configurable strategy
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Multiple subscribers                          │ Yes                      │ Stream.broadcast()
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Event buffering (EventRelay)                  │ Yes                      │ Built-in via Stream.buffer() and backpressure strategies
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Error isolation (subscribers don't crash      │ Yes                      │ Effect's error channel is separate from value channel
      │
     │ emitter)                                      │                          │
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Unsubscribe cleanup                           │ Yes                      │ Stream.runDrain() returns cleanup Effect
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Event filtering                               │ Better                   │ Runtime filtering via Stream.filter() instead of switch-case
      │
     │                                               │                          │ exhaustion
      │
     ├───────────────────────────────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ Event composition                             │ Better                   │ Stream.merge() instead of manual union types
      │
     └───────────────────────────────────────────────┴──────────────────────────┴──────────────────────────────────────────────────────────────────
     ─┘












     Surface: ~6 controller files, ~8 event type files, ~3 factory files, ~1000 LOC in reducers that could be simplified

     Leverage: High - Eliminates entire category of boilerplate (manual union types, exhaustive switch statements), improves compile times, enables
     runtime event filtering, and provides a foundation for future event-driven features (retry logic, event replay, debugging)

     ────────────────────────────────────────

     2. Architectural Seams: EventBus Package Positioning

     What exists:

     /packages/events/ is a 63-line package containing only EventBus<TEvent> class with zero dependencies. It's imported by:
     - @exitbook/blockchain-providers (emits ProviderEvent)
     - @exitbook/ingestion (emits IngestionEvent)
     - @exitbook/price-providers (emits PriceProviderEvent)
     - apps/cli (composes union types, instantiates EventBus)

     The package provides:
     - Synchronous subscription API
     - Async delivery via queueMicrotask()
     - Error isolation via onError callback
     - Queue-based ordering guarantee

     Why it's a problem:

     1. Misaligned abstraction level: The package is too low-level for the complexity it's managing. It's essentially a hand-rolled observable
     pattern without operators, backpressure, or composition primitives
     2. Cross-package event coupling: Package-level events (ProviderEvent, IngestionEvent) leak into the CLI layer, forcing the CLI to know about
     internal implementation events like provider.request.started (which the UI doesn't even render)
     3. Missing primitives: No map(), filter(), merge(), takeUntil(), etc. - features that every real event stream needs eventually
     4. Unclear package boundary: Is @exitbook/events infrastructure or domain? It's used like infrastructure but tightly coupled to domain events

     What V2 should do:

     If keeping custom EventBus:
     - Move EventBus into @exitbook/core or apps/cli/src/shared/ - it's too simple to deserve a package
     - Add event filtering at subscription time: subscribe(handler, filter: (event) => boolean)

     If adopting Effect/RxJS:
     - Delete @exitbook/events package entirely
     - Replace with library that provides composition primitives
     - Each package exports stream factories instead of event types: createProviderEvents(): Stream<ProviderEvent>

     Needs coverage:

     ┌─────────────────────────┬──────────────────────────────────────┬─────────────────────────────────────┐
     │   Current capability    │ Covered by moving to @exitbook/core? │                Notes                │
     ├─────────────────────────┼──────────────────────────────────────┼─────────────────────────────────────┤
     │ Event emission          │ Yes                                  │ Same API                            │
     ├─────────────────────────┼──────────────────────────────────────┼─────────────────────────────────────┤
     │ Subscription management │ Yes                                  │ Same API                            │
     ├─────────────────────────┼──────────────────────────────────────┼─────────────────────────────────────┤
     │ Error isolation         │ Yes                                  │ Same onError callback               │
     ├─────────────────────────┼──────────────────────────────────────┼─────────────────────────────────────┤
     │ Multi-package reuse     │ Yes                                  │ core is already a shared dependency │
     └─────────────────────────┴──────────────────────────────────────┴─────────────────────────────────────┘
     Surface: 1 package, 5 imports, ~10 instantiation sites

     Leverage: Low (if just moving) / High (if replacing with streams library)

     ────────────────────────────────────────

     3. Pattern Re-evaluation: Controller/Updater/State Triplication

     What exists:

     Both ingestion-monitor and prices-enrich UIs implement the same Controller + EventRelay + LifecycleBridge + Updater + State pattern:

     Ingestion Monitor:
     - ingestion-monitor-controller.ts (106 LOC)
     - ingestion-monitor-state.ts (233 LOC)
     - ingestion-monitor-updater.ts (1000 LOC)
     - ingestion-monitor-components.tsx (691 LOC)

     Prices Enrich:
     - prices-enrich-controller.ts (106 LOC)
     - prices-enrich-state.ts (87 LOC)
     - prices-enrich-updater.ts (275 LOC)
     - prices-enrich-components.tsx (415 LOC)

     The controller files are 97% identical:
     - Both have start(), abort(), fail(), stop(), flushRender() with same implementations
     - Both use EventRelay<TEvent> with same buffering logic
     - Both use LifecycleBridge callbacks with same timing
     - Only difference: event type generic and constructor parameters

     The pattern is:
     1. Controller subscribes to EventBus, relays to React via EventRelay
     2. Component uses useReducer + useLayoutEffect to connect
     3. Reducer delegates to updater function (giant switch statement)
     4. LifecycleBridge provides synchronous abort/fail callbacks

     Why it's a problem:

     1. Boilerplate multiplication: Each new event-driven UI requires ~120 LOC of identical controller/lifecycle code
     2. Pattern drift risk: The two implementations are already slightly different (prices-enrich has complete(), ingestion doesn't) - this will
     diverge over time
     3. Testing burden: Each controller needs identical tests (only links-view-controller.test.ts exists - 782 LOC)
     4. Hidden coupling: The EventRelay + LifecycleBridge + flushRender() dance is subtle timing magic that's easy to get wrong

     What V2 should do:

     Extract a generic EventDrivenController<TEvent, TState> base class or factory:

     class EventDrivenController<TEvent, TState> {
       constructor(
         eventBus: EventBus<TEvent>,
         component: FC<{ state: TState; ... }>,
         initialState: TState,
         reducer: (state: TState, action: Action<TEvent>) => TState,
         instrumentation?: InstrumentationCollector
       ) { /* ... */ }

       start(): void { /* shared impl */ }
       complete(): void { /* shared impl */ }
       abort(): void { /* shared impl */ }
       fail(msg: string): void { /* shared impl */ }
       stop(): Promise<void> { /* shared impl */ }
     }

     Or, if adopting Effect, use Effect's built-in lifecycle management (Effect.acquireRelease) and Stream subscription APIs, eliminating the need
     for custom controllers entirely.

     Needs coverage:
     ┌───────────────────────────────────────┬────────────────────────┬─────────────────────────────────────┐
     │          Current capability           │ Covered by base class? │                Notes                │
     ├───────────────────────────────────────┼────────────────────────┼─────────────────────────────────────┤
     │ Event buffering (EventRelay)          │ Yes                    │ Encapsulated in base                │
     ├───────────────────────────────────────┼────────────────────────┼─────────────────────────────────────┤
     │ Lifecycle callbacks (LifecycleBridge) │ Yes                    │ Generic callbacks                   │
     ├───────────────────────────────────────┼────────────────────────┼─────────────────────────────────────┤
     │ Synchronous render flush              │ Yes                    │ Base class method                   │
     ├───────────────────────────────────────┼────────────────────────┼─────────────────────────────────────┤
     │ Custom component mounting             │ Yes                    │ Pass component as constructor param │
     ├───────────────────────────────────────┼────────────────────────┼─────────────────────────────────────┤
     │ Per-UI state shape                    │ Yes                    │ Generic TState parameter            │
     ├───────────────────────────────────────┼────────────────────────┼─────────────────────────────────────┤
     │ Instrumentation plumbing              │ Yes                    │ Optional constructor param          │
     └───────────────────────────────────────┴────────────────────────┴─────────────────────────────────────┘
     Surface: 2 controller files (106 LOC each), potential 3-4 more as UIs are added

     Leverage: High - Eliminates 100+ LOC per new UI, prevents pattern drift, concentrates testing effort

     ────────────────────────────────────────

     4. Data Layer: Event Storage for Debugging

     What exists:

     Events are ephemeral - emitted, consumed by UI, discarded. No persistence, no replay, no debugging history.

     The only observability is:
     - Pino logs (text or JSON) written to files
     - InstrumentationCollector metrics (HTTP requests only, stored in-memory)
     - UI state snapshots (lost when process exits)

     Why it's a problem:

     1. Unreproducible bugs: If a user reports "the price fetch failed at 3PM", there's no event history to replay
     2. Missing audit trail: Financial accuracy depends on seeing why a price was selected, which provider was chosen, which failover occurred - al
      ephemeral events
     3. No debugging tooling: Can't inspect event timeline, can't replay events to test UI changes
     4. Performance investigation: Can't analyze event throughput or identify event storms

     What V2 should do:

     Add optional event persistence with structured storage:

     Option A: SQLite event log table
     CREATE TABLE event_log (
       id INTEGER PRIMARY KEY,
       timestamp INTEGER NOT NULL,
       event_type TEXT NOT NULL,
       event_data TEXT NOT NULL, -- JSON
       session_id TEXT, -- Links events to import/process session
       INDEX idx_timestamp (timestamp),
       INDEX idx_session (session_id)
     );

     Option B: Effect's built-in tracing
     If adopting Effect, use Effect.span() and Effect.log() to emit events to OpenTelemetry-compatible sinks (Honeycomb, Jaeger, local files).

     Needs coverage:
     ┌──────────────────────┬───────────────────────┬──────────────────────────────────────────────────────────┐
     │  Current capability  │ Covered by event log? │                          Notes                           │
     ├──────────────────────┼───────────────────────┼──────────────────────────────────────────────────────────┤
     │ UI real-time updates │ Yes                   │ Unchanged - events still emitted to UI                   │
     ├──────────────────────┼───────────────────────┼──────────────────────────────────────────────────────────┤
     │ Log file output      │ Yes                   │ Complementary, not replacement                           │
     ├──────────────────────┼───────────────────────┼──────────────────────────────────────────────────────────┤
     │ HTTP request metrics │ Partial               │ Would capture provider.* events but not full HTTP traces │
     └──────────────────────┴───────────────────────┴──────────────────────────────────────────────────────────┘
     Surface: 0 files currently (new capability)

     Leverage: Medium - High value for production debugging, but not critical for current development stage. V2 should add this as foundation befor
      production use.

     ────────────────────────────────────────

     6. File Organization: Event Type Definitions

     What exists:

     Event types are scattered across package boundaries:

     - /packages/ingestion/src/events.ts (276 LOC) - 10 event types with extensive JSDoc
     - /packages/blockchain-providers/src/events.ts (129 LOC) - 8 event types
     - /packages/price-providers/src/events.ts (16 LOC) - 2 event types
     - /apps/cli/src/features/prices/events.ts (68 LOC) - 7 event types
     - /apps/cli/src/ui/ingestion-monitor/ingestion-monitor-updater.ts:14 - Re-exports CliEvent union

     Each file defines discriminated unions with extensive inline documentation explaining where events are emitted and what consumes them.

     Why it's a problem:

     1. Package coupling: Low-level packages (blockchain-providers, price-providers) emit events consumed by high-level CLI, creating downward
     dependency for event observers
     2. Discovery friction: To understand what events exist, must read 4+ files across 3 packages
     3. Documentation split: Event documentation lives in type definitions (good) but usage is in separate files (bad for discoverability)
     4. Naming inconsistency: Some events use provider.request.started, others use stage.started - no clear naming convention

     What V2 should do:

     Option A: Centralized event registry (if keeping union types)
     /packages/events/src/
       registry.ts          # All event type definitions
       ingestion-events.ts  # Re-export subset
       provider-events.ts   # Re-export subset
       price-events.ts      # Re-export subset

     Option B: Event factories (if adopting streams)
     /packages/ingestion/src/
       events/
         import-events.ts    # createImportEvents(): Stream<ImportEvent>
         process-events.ts   # createProcessEvents(): Stream<ProcessEvent>
         index.ts
     Each package exports stream factories, not types. Consumers merge streams at runtime.

     Needs coverage:
     ┌────────────────────────────────┬──────────────────────────────────┬──────────────────────────────┐
     │       Current capability       │ Covered by centralized registry? │            Notes             │
     ├────────────────────────────────┼──────────────────────────────────┼──────────────────────────────┤
     │ Type-safe event discrimination │ Yes                              │ Same discriminated unions    │
     ├────────────────────────────────┼──────────────────────────────────┼──────────────────────────────┤
     │ Package-specific event subsets │ Yes                              │ Re-exports from registry     │
     ├────────────────────────────────┼──────────────────────────────────┼──────────────────────────────┤
     │ JSDoc documentation            │ Yes                              │ Centralized location         │
     ├────────────────────────────────┼──────────────────────────────────┼──────────────────────────────┤
     │ Event filtering by package     │ No                               │ Would need runtime filtering │
     └────────────────────────────────┴──────────────────────────────────┴──────────────────────────────┘
     Surface: 4 event definition files, 6+ import sites

     Leverage: Low - Organizational improvement but doesn't reduce code or fix composition issues

     ────────────────────────────────────────

     7. Pattern Re-evaluation: LifecycleBridge Synchronous Dispatch

     What exists:

     LifecycleBridge interface:
     export interface LifecycleBridge {
       onAbort?: (() => void) | undefined;
       onComplete?: (() => void) | undefined;
       onFail?: ((errorMessage: string) => void) | undefined;
     }

     Controllers populate these callbacks, then call this.flushRender() to force synchronous React state updates before process.exit().

     From prices-enrich-controller.ts:
     abort(): void {
       this.lifecycle.onAbort?.();
       this.flushRender();  // Force synchronous render
     }

     From prices-enrich-components.tsx:
     useLayoutEffect(() => {
       lifecycle.onAbort = () => dispatch({ type: 'abort' });
       lifecycle.onFail = (errorMessage: string) => dispatch({ type: 'fail', errorMessage });
       lifecycle.onComplete = () => dispatch({ type: 'complete' });
       return () => { /* clear callbacks */ };
     }, [relay, lifecycle]);

     Why it's a problem:

     1. Timing magic: The flushRender() + useLayoutEffect combo is subtle React internals knowledge that's not self-documenting
     2. Fragile: If someone removes flushRender() call, abort/fail states won't render before process.exit()
     3. Callback soup: Three optional callbacks registered via useLayoutEffect side-effects - easy to forget one
     4. Testing difficulty: Must mock Ink's render lifecycle to test this timing

     What V2 should do:

     Option A: Structured shutdown signal
     Instead of callbacks, use a shutdown Effect/Promise that controllers await:

     const shutdownSignal = Effect.Deferred.make<ShutdownReason>();

     // In controller:
     await Effect.race(
       handler.execute(),
       shutdownSignal.await()  // Blocks until abort/fail/complete
     );

     // Signal handlers:
     process.on('SIGINT', () => shutdownSignal.succeed({ type: 'abort' }));

     Option B: React Suspense boundaries
     Use React 18's Suspense + Error Boundaries for lifecycle instead of imperative callbacks.

     Needs coverage:
     ┌──────────────────────────────────┬──────────────────────┬────────────────────────────────────────────┐
     │        Current capability        │ Covered by Deferred? │                   Notes                    │
     ├──────────────────────────────────┼──────────────────────┼────────────────────────────────────────────┤
     │ Abort signal (Ctrl-C)            │ Yes                  │ Deferred.interrupt()                       │
     ├──────────────────────────────────┼──────────────────────┼────────────────────────────────────────────┤
     │ Fail signal (error)              │ Yes                  │ Deferred.fail(error)                       │
     ├──────────────────────────────────┼──────────────────────┼────────────────────────────────────────────┤
     │ Complete signal                  │ Yes                  │ Deferred.succeed()                         │
     ├──────────────────────────────────┼──────────────────────┼────────────────────────────────────────────┤
     │ Synchronous dispatch before exit │ Yes                  │ Await Deferred before exit                 │
     ├──────────────────────────────────┼──────────────────────┼────────────────────────────────────────────┤
     │ No flushRender() needed          │ Better               │ Natural async boundary, no React internals │
     └──────────────────────────────────┴──────────────────────┴────────────────────────────────────────────┘
     Surface: 2 controller files, 2 component hooks

     Leverage: Medium - Improves clarity and testability but doesn't reduce LOC significantly

     ────────────────────────────────────────

     V2 DECISION SUMMARY
     ┌──────┬────────────────────────────────────┬───────────────────┬──────────┬──────────────────────────────────────────────────────────────────
     ─┐
     │ Rank │               Change               │     Dimension     │ Leverage │                         One-line Rationale
      │
     ├──────┼────────────────────────────────────┼───────────────────┼──────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ 1    │ Replace union-type events with     │ Pattern           │ High     │ Eliminates 1000+ LOC of switch-case reducers, enables runtime
      │
     │      │ Effect Streams                     │ Re-evaluation     │          │ filtering, provides composition primitives
      │
     ├──────┼────────────────────────────────────┼───────────────────┼──────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ 2    │ Extract EventDrivenController base │ Pattern           │ High     │ Prevents 100+ LOC duplication per new UI, eliminates pattern drif
      │
     │      │  class                             │ Re-evaluation     │          │  risk
      │
     ├──────┼────────────────────────────────────┼───────────────────┼──────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ 3    │ Delete EventRelay, use             │ Dependency Audit  │ Medium   │ Replaces 34 LOC hand-rolled code with library primitive, adds
      │
     │      │ Stream.buffer()                    │                   │          │ backpressure
      │
     ├──────┼────────────────────────────────────┼───────────────────┼──────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ 4    │ Add event persistence to SQLite    │ Data Layer        │ Medium   │ Enables production debugging, audit trails, and performance
      │
     │      │                                    │                   │          │ analysis
      │
     ├──────┼────────────────────────────────────┼───────────────────┼──────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ 5    │ Replace LifecycleBridge with       │ Pattern           │ Medium   │ Removes timing magic, improves testability, clearer async
      │
     │      │ Effect.Deferred                    │ Re-evaluation     │          │ boundaries
      │
     ├──────┼────────────────────────────────────┼───────────────────┼──────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ 6    │ Delete @exitbook/events package    │ Architectural     │ Low      │ Infrastructure too simple to deserve a package; move to core or
      │
     │      │                                    │ Seams             │          │ replace entirely
      │
     ├──────┼────────────────────────────────────┼───────────────────┼──────────┼──────────────────────────────────────────────────────────────────
     ─┤
     │ 7    │ Centralize event type definitions  │ File Organization │ Low      │ Organizational improvement, doesn't fix composition issues
      │
     └──────┴────────────────────────────────────┴───────────────────┴──────────┴──────────────────────────────────────────────────────────────────
     ─┘













     ────────────────────────────────────────

     WHAT V2 KEEPS

     These patterns and tools earned their place and should carry forward:

     1. neverthrow Result types - Critical for financial accuracy, excellent DX, well-adopted across codebase
     2. Ink for TUI - Productive, type-safe React-based terminal UIs with excellent composability
     3. Pino for logging - Fast, structured, well-configured with sinks
     4. InstrumentationCollector - Clean abstraction for HTTP metrics, nicely decoupled
     5. Vertical slice organization - features/prices/ containing handler, events, prompts, utils is excellent DX
     6. useReducer pattern in React components - State management is clean and testable
     7. Zod schemas for validation - Runtime safety at boundaries, great TypeScript integration

     ────────────────────────────────────────

     CONCLUSION

     The event handling is messy structurally, not individually. Each piece (EventBus, EventRelay, LifecycleBridge, reducers) is well-implemented
     for its purpose, but they compose awkwardly because the codebase is fighting against TypeScript's type system instead of using it as leverage.

     The root issue: compile-time union types force manual composition, when events should be runtime-composable streams. This creates cascading
     problems: giant reducers, type duplication, no filtering, pattern multiplication.

     V2's most impactful change: Adopt https://effect.website/docs/stream/stream or RxJS Observables for event composition. This single
     architectural shift would:
     - Eliminate ~1275 LOC of boilerplate reducers
     - Enable runtime event filtering (UI only subscribes to events it renders)
     - Provide battle-tested composition primitives (merge, filter, map, takeUntil)
     - Unlock advanced features (event replay, tracing, backpressure)
     - Prevent future duplication as more event-driven UIs are added

     Effect is recommended over RxJS because it provides integrated error handling (separates error channel from value channel), context tracking,
     and resource management - all of which this codebase already handles manually via neverthrow, dependency injection, and explicit cleanup.
     Effect would unify these concerns.

     Sources:
     - https://www.tweag.io/blog/2024-11-07-typescript-effect/
     - https://effect.website/
     - https://effect.website/docs/getting-started/why-effect/
