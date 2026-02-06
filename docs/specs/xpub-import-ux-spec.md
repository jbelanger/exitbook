# Xpub Import UX Specification

## Problem Statement

When importing from extended public keys (xpub/ypub/zpub), users experience two critical issues:

1. **Invisible derivation phase** - Address derivation makes API calls for smart detection and gap scanning, but shows no progress
2. **Confusing per-address display** - Each derived address shows as a separate account import without xpub context
3. **Missing stream breakdown** - Single-stream imports (Bitcoin) don't show stream tree structure

### Current Broken UX

```
✓ Account #20 (resuming)
✓ 3 providers ready
⠹ Importing · 24ms

⚠ Aborted (24ms)

─────────────────────────────────────────────────────────────────────────────────
blockstream…  4.8 req/s            128ms   16 calls   16 ok (200)
```

**Problems:**

- No indication that this is an xpub import
- Account line changes for each child address
- "16 calls" are from derivation, but no context shown
- No stream breakdown

## Proposed UX

### Scenario 1: New Xpub Import (First Time)

**Phase 1: Account Creation & Derivation**

```
✓ Created parent account #42 (xpub)
⠹ Deriving addresses · 1.2s
✓ 3 providers ready

─────────────────────────────────────────────────────────────────────────────────
blockstream…  ● 4.8 req/s          128ms   16 calls   16 ok (200)
```

**After derivation completes:**

```
✓ Created parent account #42 (xpub)
✓ Derived 24 addresses (2.4s)
✓ 3 providers ready
```

**Phase 2: Aggregated Import**

```
✓ Created parent account #42 (xpub)
✓ Derived 24 addresses (2.4s)
✓ 3 providers ready
⠹ Importing 24 addresses · 5.3s
  └─ normal: batch 18 · 5.3s
     └─ 3,421 imported · blockstream 6.2 req/s

─────────────────────────────────────────────────────────────────────────────────
blockstream…  ● 6.2 req/s          145ms   89 calls   89 ok (200)
```

**Phase 3: Processing**

```
✓ Created parent account #42 (xpub)
✓ Derived 24 addresses (2.4s)
✓ 3 providers ready
✓ Importing 24 addresses (8.7s)
  └─ normal: 3,421 new (8.7s)

⠹ Processing · 1.1s
  ├─ 3,421 / 3,421 raw transactions
  └─ Token metadata: 142 cached, 89 fetched · coingecko 5.1 req/s

─────────────────────────────────────────────────────────────────────────────────
blockstream…  5.8 req/s            142ms   124 calls   124 ok (200)
coingecko…    ● 5.1 req/s          230ms   89 calls    89 ok (200)
```

**Phase 4: Completion**

```
✓ Created parent account #42 (xpub)
✓ Derived 24 addresses (2.4s)
✓ 3 providers ready
✓ Importing 24 addresses (8.7s)
  └─ normal: 3,421 new (8.7s)

✓ Processing (1.2s)
  ├─ 3,421 raw → 3,421 transactions
  └─ Token metadata: 142 cached, 89 fetched (95% cached)

✓ Done (12.3s)

─────────────────────────────────────────────────────────────────────────────────
blockstream…  5.8 req/s            142ms   124 calls   124 ok (200)
coingecko…    5.0 req/s            235ms   94 calls    94 ok (200)
```

### Scenario 2: Resume Xpub Import (Reuse Cached Children)

```
✓ Account #42 (xpub · resuming)
  Reusing 24 existing child accounts
  3,421 transactions
    normal: 3,421
✓ 3 providers ready
⠹ Importing 24 addresses · 0.8s
  └─ normal: batch 2 · 0.8s
     └─ 15 imported · blockstream 6.1 req/s

─────────────────────────────────────────────────────────────────────────────────
blockstream…  ● 6.1 req/s          138ms   12 calls   12 ok (200)
```

**Key differences:**

- No "Created parent account" (already exists)
- Shows "Reusing 24 existing child accounts" instead of derivation
- Shows existing transaction counts with stream breakdown
- Proceeds directly to import

### Scenario 3: Resume Xpub with Increased Gap

```
✓ Account #42 (xpub · resuming)
  3,421 transactions
    normal: 3,421
⠹ Re-deriving addresses (gap increased: 20 → 40) · 1.5s
✓ 3 providers ready

─────────────────────────────────────────────────────────────────────────────────
blockstream…  ● 4.8 req/s          128ms   24 calls   24 ok (200)
```

**After re-derivation:**

```
✓ Account #42 (xpub · resuming)
  3,421 transactions
    normal: 3,421
✓ Derived 35 addresses (11 new) (3.2s)
✓ 3 providers ready
⠹ Importing 35 addresses · 2.1s
  └─ normal: batch 5 · 2.1s
     └─ 234 imported · blockstream 6.3 req/s
```

### Scenario 4: Xpub with No Active Addresses

```
✓ Created parent account #42 (xpub)
✓ Derived 0 addresses (1.8s)

⚠ Completed with 1 warning (1.8s)
 No active addresses found for xpub

─────────────────────────────────────────────────────────────────────────────────
blockstream…  4.2 req/s            152ms   18 calls   18 ok (200)
```

### Scenario 5: Derivation Failure

```
✓ Created parent account #42 (xpub)
⠹ Deriving addresses · 2.1s

⚠ Failed (2.1s)
Failed to derive addresses: API error after 3 retries

─────────────────────────────────────────────────────────────────────────────────
blockstream…  3.2 req/s            256ms   8 calls    5 ok (200) · 3 err (503)
```

### Scenario 6: Child Import Failure (Any Child Fails = Entire Xpub Fails)

```
✓ Created parent account #42 (xpub)
✓ Derived 24 addresses (2.4s)
✓ 3 providers ready
⠹ Importing 24 addresses · 4.2s
  └─ normal: batch 12 · 4.2s
     └─ 1,842 imported · blockstream 6.0 req/s

⚠ Failed (6.6s)
Failed to import child account #56: Connection timeout

─────────────────────────────────────────────────────────────────────────────────
blockstream…  4.8 req/s            178ms   67 calls   64 ok (200) · 3 err (timeout)
```

**Note:** Import stops immediately on first child failure. No partial success.

## Event Specifications

### New Event Types

#### Xpub Derivation Events

```typescript
/**
 * Emitted when xpub address derivation begins
 * Location: ImportOrchestrator.importFromXpub() - before calling deriveAddressesFromXpub()
 */
interface XpubDerivationStartedEvent {
  type: 'xpub.derivation.started';
  parentAccountId: number;
  blockchain: string;
  gapLimit: number;
  isRederivation: boolean; // True if re-deriving with increased gap
  parentIsNew: boolean; // True if parent account was just created
  previousGap?: number | undefined; // Present when re-deriving
}

/**
 * Emitted when xpub address derivation completes successfully
 * Location: ImportOrchestrator.importFromXpub() - after deriveAddressesFromXpub() returns
 */
interface XpubDerivationCompletedEvent {
  type: 'xpub.derivation.completed';
  parentAccountId: number;
  derivedCount: number;
  newCount?: number | undefined; // Only present if isRederivation, shows newly added addresses
  durationMs: number;
}

/**
 * Emitted when xpub derivation fails
 * Location: ImportOrchestrator.importFromXpub() - if deriveAddressesFromXpub() returns error
 */
interface XpubDerivationFailedEvent {
  type: 'xpub.derivation.failed';
  parentAccountId: number;
  error: string;
  durationMs: number;
}
```

#### Xpub Import Wrapper Events

```typescript
/**
 * Emitted when xpub import begins (wrapper for all child imports)
 * Location: ImportOrchestrator.importFromXpub() - after creating child accounts, before importing them
 */
interface XpubImportStartedEvent {
  type: 'xpub.import.started';
  parentAccountId: number;
  childAccountCount: number;
  blockchain: string;
  parentIsNew: boolean; // True if parent account was just created
}

/**
 * Emitted when xpub import completes (all children imported)
 * Location: ImportOrchestrator.importFromXpub() - after all child imports succeed
 */
interface XpubImportCompletedEvent {
  type: 'xpub.import.completed';
  parentAccountId: number;
  sessions: ImportSession[];
  totalImported: number;
  totalSkipped: number;
}

/**
 * Emitted when any child import fails (entire xpub import fails)
 * Location: ImportOrchestrator.importFromXpub() - when a child import returns error
 */
interface XpubImportFailedEvent {
  type: 'xpub.import.failed';
  parentAccountId: number;
  failedChildAccountId: number;
  error: string;
}
```

#### Enhanced Existing Events

```typescript
/**
 * Enhanced import.started event - add parentAccountId for xpub child context
 * Location: ImportExecutor.executeStreamingImport()
 */
interface ImportStartedEvent {
  type: 'import.started';
  sourceName: string;
  sourceType: AccountType;
  accountId: number;
  parentAccountId?: number | undefined; // NEW: Present if this is a child of an xpub parent
  isNewAccount: boolean;
  address?: string;
  transactionCounts?: Map<string, number>;
}

/**
 * Enhanced import.batch event - no changes needed, parentAccountId tracked via state
 */
interface ImportBatchEvent {
  type: 'import.batch';
  streamType: string;
  batchInserted: number;
  batchSkipped: number;
  totalImported: number;
  totalSkipped: number;
  isComplete: boolean;
}

/**
 * New warning event for empty xpub
 * Location: ImportOrchestrator.importFromXpub() - when derivedAddresses.length === 0
 */
interface XpubEmptyWarningEvent {
  type: 'xpub.empty';
  parentAccountId: number;
  blockchain: string;
}
```

### Event Emission Flow

#### New Xpub Import Flow

```typescript
// File: packages/ingestion/src/features/import/import-orchestrator.ts

private async importFromXpub(
  userId: number,
  blockchain: string,
  xpub: string,
  blockchainAdapter: BlockchainAdapter,
  providerName?: string,
  xpubGap?: number
): Promise<Result<ImportSession[], Error>> {
  const startTime = Date.now();
  const requestedGap = xpubGap ?? getDefaultGap(blockchain);

  // 1. Create parent account
  const parentAccountResult = await this.accountRepository.findOrCreate({
    userId,
    accountType: 'blockchain',
    sourceName: blockchain,
    identifier: xpub,
    providerName,
    credentials: undefined
  });
  if (parentAccountResult.isErr()) return err(parentAccountResult.error);

  const parentAccount = parentAccountResult.value;
  const parentAlreadyExists = parentAccount.metadata?.xpub !== undefined;

  // 2. Check if we need to re-derive
  const existingMetadata = parentAccount.metadata?.xpub;
  const shouldRederive = !existingMetadata || requestedGap > existingMetadata.gapLimit;

  let childAccounts: Account[];
  let derivedCount = 0;
  let newlyDerivedCount = 0;

  if (shouldRederive) {
    // 2a. Emit derivation started
    this.eventBus?.emit({
      type: 'xpub.derivation.started',
      parentAccountId: parentAccount.id,
      blockchain,
      gapLimit: requestedGap,
      isRederivation: Boolean(existingMetadata),
      parentIsNew: !parentAlreadyExists,
      previousGap: existingMetadata?.gapLimit
    });

    // 2b. Derive addresses (opaque operation - may emit provider events)
    let derivedAddresses: DerivedAddress[];
    try {
      derivedAddresses = await blockchainAdapter.deriveAddressesFromXpub(
        xpub,
        this.providerManager,
        blockchain,
        requestedGap
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.eventBus?.emit({
        type: 'xpub.derivation.failed',
        parentAccountId: parentAccount.id,
        error: error instanceof Error ? error.message : String(error),
        durationMs
      });
      return err(error instanceof Error ? error : new Error(String(error)));
    }

    derivedCount = derivedAddresses.length;
    const derivationDuration = Date.now() - startTime;

    // 2c. Handle empty xpub
    if (derivedCount === 0) {
      this.eventBus?.emit({
        type: 'xpub.derivation.completed',
        parentAccountId: parentAccount.id,
        derivedCount: 0,
        durationMs: derivationDuration
      });

      this.eventBus?.emit({
        type: 'xpub.empty',
        parentAccountId: parentAccount.id,
        blockchain
      });

      return ok([]);
    }

    // 2d. Create child accounts for each derived address
    childAccounts = [];
    for (const derived of derivedAddresses) {
      const normalizedResult = blockchainAdapter.normalizeAddress(derived.address);
      if (normalizedResult.isErr()) {
        this.logger.warn(`Skipping invalid derived address: ${derived.address}`);
        continue;
      }

      const childResult = await this.accountRepository.findOrCreate({
        userId,
        parentAccountId: parentAccount.id,
        accountType: 'blockchain',
        sourceName: blockchain,
        identifier: normalizedResult.value,
        providerName,
        credentials: undefined
      });

      if (childResult.isErr()) return err(childResult.error);
      childAccounts.push(childResult.value);
    }

    // Calculate newly derived count if re-derivation
    if (existingMetadata) {
      newlyDerivedCount = childAccounts.length - (existingMetadata.derivedCount ?? 0);
    }

    // 2e. Emit derivation completed
    this.eventBus?.emit({
      type: 'xpub.derivation.completed',
      parentAccountId: parentAccount.id,
      derivedCount: childAccounts.length,
      newCount: existingMetadata ? newlyDerivedCount : undefined,
      durationMs: derivationDuration
    });

    // 2f. Update parent metadata
    await this.accountRepository.update(parentAccount.id, {
      metadata: {
        xpub: {
          gapLimit: requestedGap,
          lastDerivedAt: Date.now(),
          derivedCount: childAccounts.length
        }
      }
    });

    this.logger.info(
      `Derived ${childAccounts.length} addresses` +
      (newlyDerivedCount > 0 ? ` (${newlyDerivedCount} new)` : '')
    );
  } else {
    // 2g. Reuse existing children
    const childrenResult = await this.accountRepository.findByParent(parentAccount.id);
    if (childrenResult.isErr()) return err(childrenResult.error);

    childAccounts = childrenResult.value;
    this.logger.info(`Reusing ${childAccounts.length} existing child accounts`);
  }

  // 3. Emit xpub import started (must be before any child import.started)
  this.eventBus?.emit({
    type: 'xpub.import.started',
    parentAccountId: parentAccount.id,
    childAccountCount: childAccounts.length,
    blockchain,
    parentIsNew: !parentAlreadyExists
  });

  // 4. Import each child account
  const importSessions: ImportSession[] = [];

  for (const childAccount of childAccounts) {
    this.logger.info(`Importing child account #${childAccount.id}`);

    const importResult = await this.importExecutor.importFromSource(childAccount);

    if (importResult.isErr()) {
      // Any child failure = entire xpub import fails
      this.eventBus?.emit({
        type: 'xpub.import.failed',
        parentAccountId: parentAccount.id,
        failedChildAccountId: childAccount.id,
        error: importResult.error.message
      });

      return err(new Error(
        `Failed to import child account #${childAccount.id}: ${importResult.error.message}`
      ));
    }

    importSessions.push(importResult.value);
  }

  // 5. Calculate totals
  const totalImported = importSessions.reduce((sum, s) => sum + s.transactionsImported, 0);
  const totalSkipped = importSessions.reduce((sum, s) => sum + s.transactionsSkipped, 0);

  // 6. Emit xpub import completed
  this.eventBus?.emit({
    type: 'xpub.import.completed',
    parentAccountId: parentAccount.id,
    sessions: importSessions,
    totalImported,
    totalSkipped
  });

  this.logger.info(
    `Completed xpub import: ${totalImported} transactions from ${importSessions.length} addresses`
  );

  return ok(importSessions);
}
```

#### Enhanced Child Import Event Emission

```typescript
// File: packages/ingestion/src/features/import/import-service.ts

private async executeStreamingImport(
  account: Account,
  importer: IImporter,
  params: ImportParams
): Promise<Result<ImportSession, Error>> {
  // ... session creation logic ...

  // Emit import.started with parentAccountId context
  this.eventBus?.emit({
    type: 'import.started',
    sourceName,
    sourceType: account.accountType,
    accountId: account.id,
    parentAccountId: account.parentAccountId,  // NEW: Links to xpub parent if present
    isNewAccount,
    address: account.accountType === 'blockchain' ? account.identifier : undefined,
    transactionCounts
  });

  // ... rest of import logic unchanged ...
}
```

## Dashboard State Changes

### New State Interfaces

```typescript
// File: apps/cli/src/ui/dashboard/dashboard-state.ts

/**
 * Xpub derivation operation state
 */
export interface DerivationOperation {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  isRederivation: boolean;
  gapLimit: number;
  previousGap?: number | undefined;
  derivedCount?: number | undefined;
  newCount?: number | undefined; // For re-derivation only
}

/**
 * Xpub import wrapper state (aggregates child imports)
 */
export interface XpubImportWrapper {
  parentAccountId: number;
  childAccountCount: number;
  blockchain: string;

  // Aggregated streams across all children
  aggregatedStreams: Map<string, StreamState>;
}

/**
 * Enhanced AccountInfo for xpub context
 */
export interface AccountInfo {
  id: number;
  isNewAccount: boolean;
  isXpubParent?: boolean | undefined; // NEW: Is this an xpub parent account?
  childAccountCount?: number | undefined; // NEW: Number of derived addresses
  transactionCounts?: Map<string, number> | undefined;
}

/**
 * Complete Dashboard State
 */
export interface DashboardState {
  account?: AccountInfo | undefined;
  providerReadiness?: ProviderReadiness | undefined;
  blockchain?: string | undefined;

  // NEW: Derivation operation
  derivation?: DerivationOperation | undefined;

  // NEW: Xpub import wrapper (when importing xpub)
  xpubImport?: XpubImportWrapper | undefined;

  import?: ImportOperation | undefined;
  processing?: ProcessingOperation | undefined;
  apiCalls: ApiCallStats;
  isComplete: boolean;
  aborted?: boolean | undefined;
  errorMessage?: string | undefined;
  totalDurationMs?: number | undefined;
  warnings: Warning[];
}
```

### Dashboard State Update Logic

Provider readiness should be set when the first `provider.selection` or `provider.resume` arrives and either
`state.import` or `state.derivation` is active. If `state.import` is not yet set, compute readiness duration
from `state.derivation.startedAt`.

```typescript
// File: apps/cli/src/ui/dashboard/dashboard-updater.ts

/**
 * Handle xpub.derivation.started event
 */
function handleXpubDerivationStarted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'xpub.derivation.started' }>
): void {
  state.derivation = {
    status: 'active',
    startedAt: performance.now(),
    isRederivation: event.isRederivation,
    gapLimit: event.gapLimit,
    previousGap: event.previousGap,
  };

  // Mark account as xpub parent
  if (!state.account) {
    state.account = {
      id: event.parentAccountId,
      isNewAccount: event.parentIsNew,
      isXpubParent: true,
    };
  } else {
    state.account.isXpubParent = true;
  }
}

/**
 * Handle xpub.derivation.completed event
 */
function handleXpubDerivationCompleted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'xpub.derivation.completed' }>
): void {
  if (!state.derivation) return;

  state.derivation.status = 'completed';
  state.derivation.completedAt = performance.now();
  state.derivation.derivedCount = event.derivedCount;
  state.derivation.newCount = event.newCount;

  // Update account info
  if (state.account) {
    state.account.childAccountCount = event.derivedCount;
  }
}

/**
 * Handle xpub.derivation.failed event
 */
function handleXpubDerivationFailed(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'xpub.derivation.failed' }>
): void {
  if (!state.derivation) return;

  state.derivation.status = 'failed';
  state.derivation.completedAt = performance.now();

  state.isComplete = true;
  state.errorMessage = `Failed to derive addresses: ${event.error}`;
  state.totalDurationMs = performance.now() - state.derivation.startedAt;
}

/**
 * Handle xpub.import.started event
 */
function handleXpubImportStarted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'xpub.import.started' }>
): void {
  state.xpubImport = {
    parentAccountId: event.parentAccountId,
    childAccountCount: event.childAccountCount,
    blockchain: event.blockchain,
    aggregatedStreams: new Map(),
  };

  // Create import operation (will be populated by child import events)
  state.import = {
    status: 'active',
    startedAt: performance.now(),
    streams: new Map(),
  };

  if (!state.account) {
    state.account = {
      id: event.parentAccountId,
      isNewAccount: event.parentIsNew,
      isXpubParent: true,
      childAccountCount: event.childAccountCount,
    };
  } else if (state.account.isXpubParent) {
    state.account.childAccountCount = event.childAccountCount;
  }
}

/**
 * Handle import.started event - enhanced for xpub children
 */
function handleImportStarted(state: DashboardState, event: Extract<IngestionEvent, { type: 'import.started' }>): void {
  // If this is a child of an xpub import, don't overwrite state
  if (event.parentAccountId && state.xpubImport) {
    // This is a child import - state.import already exists from xpub.import.started
    // Just track child account info
    return;
  }

  // Normal import (not xpub child)
  state.account = {
    id: event.accountId,
    isNewAccount: event.isNewAccount,
    transactionCounts: event.transactionCounts,
  };

  state.import = {
    status: 'active',
    startedAt: performance.now(),
    streams: new Map(),
  };
}

/**
 * Handle import.batch event - enhanced for xpub aggregation
 */
function handleImportBatch(state: DashboardState, event: Extract<IngestionEvent, { type: 'import.batch' }>): void {
  if (!state.import) return;

  if (state.xpubImport) {
    // Aggregate into xpubImport.aggregatedStreams instead of per-account streams
    let stream = state.xpubImport.aggregatedStreams.get(event.streamType);

    if (!stream) {
      stream = {
        name: event.streamType,
        status: 'active',
        startedAt: state.import.startedAt,
        imported: 0,
        currentBatch: 0,
        activeProvider: state.currentProvider,
      };
      state.xpubImport.aggregatedStreams.set(event.streamType, stream);
    }

    stream.currentBatch = (stream.currentBatch || 0) + 1;
    stream.imported += event.batchInserted;

    // Do not mark aggregated streams complete here.
    // Completion is handled by xpub.import.completed after all children finish.
  } else {
    // Normal per-stream handling (unchanged from current implementation)
    let stream = state.import.streams.get(event.streamType);

    if (!stream) {
      stream = {
        name: event.streamType,
        status: 'active',
        startedAt: resolveStreamStartTime(state.import),
        imported: 0,
        currentBatch: 0,
        activeProvider: state.currentProvider,
      };
      state.import.streams.set(event.streamType, stream);
    }

    stream.currentBatch = (stream.currentBatch || 0) + 1;
    stream.imported += event.batchInserted;

    if (event.isComplete) {
      stream.status = 'completed';
      stream.completedAt = performance.now();
      stream.currentBatch = undefined;
    }
  }
}

/**
 * Handle xpub.import.completed event
 */
function handleXpubImportCompleted(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'xpub.import.completed' }>
): void {
  if (!state.import) return;

  state.import.status = 'completed';
  state.import.completedAt = performance.now();

  // Mark all aggregated streams as completed
  if (state.xpubImport) {
    for (const stream of state.xpubImport.aggregatedStreams.values()) {
      if (stream.status === 'active') {
        stream.status = 'completed';
        stream.completedAt = performance.now();
        stream.currentBatch = undefined;
      }
    }
  }
}

/**
 * Handle xpub.import.failed event
 */
function handleXpubImportFailed(
  state: DashboardState,
  event: Extract<IngestionEvent, { type: 'xpub.import.failed' }>
): void {
  if (!state.import) return;

  state.import.status = 'failed';
  state.import.completedAt = performance.now();

  state.isComplete = true;
  state.errorMessage = event.error;
  state.totalDurationMs = performance.now() - state.import.startedAt;
}

/**
 * Handle xpub.empty event
 */
function handleXpubEmpty(state: DashboardState, event: Extract<IngestionEvent, { type: 'xpub.empty' }>): void {
  state.isComplete = true;
  state.warnings.push({
    message: 'No active addresses found for xpub',
  });

  if (state.derivation) {
    state.totalDurationMs = performance.now() - state.derivation.startedAt;
  }
}

/**
 * Enhanced updateStateFromEvent with new handlers
 */
export function updateStateFromEvent(
  state: DashboardState,
  event: CliEvent,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager
): void {
  switch (event.type) {
    // New xpub events
    case 'xpub.derivation.started':
      handleXpubDerivationStarted(state, event);
      break;
    case 'xpub.derivation.completed':
      handleXpubDerivationCompleted(state, event);
      break;
    case 'xpub.derivation.failed':
      handleXpubDerivationFailed(state, event);
      break;
    case 'xpub.import.started':
      handleXpubImportStarted(state, event);
      break;
    case 'xpub.import.completed':
      handleXpubImportCompleted(state, event);
      break;
    case 'xpub.import.failed':
      handleXpubImportFailed(state, event);
      break;
    case 'xpub.empty':
      handleXpubEmpty(state, event);
      break;

    // Existing events (enhanced handlers)
    case 'import.started':
      handleImportStarted(state, event);
      break;
    case 'import.batch':
      handleImportBatch(state, event);
      break;

    // All other existing events unchanged
    // ...
  }
}
```

## Dashboard Component Changes

### New Components

```typescript
// File: apps/cli/src/ui/dashboard/dashboard-components.tsx

/**
 * Derivation operation section
 */
const DerivationSection: React.FC<{ derivation: DerivationOperation }> = ({ derivation }) => {
  const elapsed = derivation.completedAt
    ? derivation.completedAt - derivation.startedAt
    : performance.now() - derivation.startedAt;
  const duration = formatDuration(elapsed);

  const actionText = derivation.isRederivation ? 'Re-deriving addresses' : 'Deriving addresses';
  const gapText = derivation.isRederivation
    ? ` (gap increased: ${derivation.previousGap ?? '—'} → ${derivation.gapLimit})`
    : '';

  if (derivation.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>{actionText}</Text>
        {gapText} <Text dimColor>· {duration}</Text>
      </Text>
    );
  }

  if (derivation.status === 'completed') {
    const countText = derivation.newCount !== undefined
      ? `${derivation.derivedCount} addresses (${derivation.newCount} new)`
      : `${derivation.derivedCount} addresses`;

    return (
      <Text>
        {statusIcon('completed')} Derived {countText} <Text dimColor>({duration})</Text>
      </Text>
    );
  }

  return null;
};

/**
 * Enhanced AccountLine for xpub context
 */
const AccountLine: React.FC<{
  accountId: number;
  isNewAccount: boolean;
  isXpubParent?: boolean;
  childAccountCount?: number;
  transactionCounts?: Map<string, number>;
}> = ({ accountId, isNewAccount, isXpubParent, childAccountCount, transactionCounts }) => {
  // Xpub parent account
  if (isXpubParent) {
    if (isNewAccount) {
      return (
        <Text>
          <Text color="green">✓</Text> Created parent account #{accountId} <Text dimColor>(xpub)</Text>
        </Text>
      );
    }

    // Resuming xpub
    const totalTransactions = transactionCounts
      ? Array.from(transactionCounts.values()).reduce((sum, count) => sum + count, 0)
      : 0;

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">✓</Text> Account #{accountId}{' '}
          <Text dimColor>
            (xpub · resuming)
          </Text>
        </Text>
        {childAccountCount && (
          <Text>
            {'  '}
            Reusing {childAccountCount} existing child accounts
          </Text>
        )}
        {totalTransactions > 0 && (
          <Text>
            {'  '}
            {totalTransactions.toLocaleString()} transactions
          </Text>
        )}
        {transactionCounts && transactionCounts.size > 0 && (
          <Text>
            {'    '}
            {Array.from(transactionCounts.entries())
              .sort(([, a], [, b]) => b - a)
              .map(([streamType, count]) => `${streamType}: ${count.toLocaleString()}`)
              .join(' · ')}
          </Text>
        )}
      </Box>
    );
  }

  // Normal account (non-xpub) - unchanged from current implementation
  if (!isNewAccount) {
    const totalTransactions = transactionCounts
      ? Array.from(transactionCounts.values()).reduce((sum, count) => sum + count, 0)
      : 0;

    const hasBreakdown = transactionCounts && transactionCounts.size > 0;
    const breakdownParts: React.ReactNode[] = [];

    if (hasBreakdown) {
      const sortedCounts = Array.from(transactionCounts.entries()).sort(([, a], [, b]) => b - a);

      for (const [streamType, count] of sortedCounts) {
        if (breakdownParts.length > 0) {
          breakdownParts.push(<Text key={`sep-${streamType}`}> · </Text>);
        }
        breakdownParts.push(
          <Text key={streamType}>
            {streamType}: {count.toLocaleString()}
          </Text>
        );
      }
    }

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">✓</Text> Account #{accountId}{' '}
          <Text dimColor>
            (resuming
            {totalTransactions > 0 && ` · ${totalTransactions.toLocaleString()} transactions`})
          </Text>
        </Text>
        {hasBreakdown && (
          <Text>
            {'  '}
            {breakdownParts}
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Text>
      <Text color="green">✓</Text> Created account #{accountId}
    </Text>
  );
};

/**
 * Enhanced ImportSection for xpub aggregation
 */
const ImportSection: React.FC<{ import: ImportOperation; xpubImport?: XpubImportWrapper }> = ({
  import: importOp,
  xpubImport
}) => {
  const elapsed = importOp.completedAt
    ? importOp.completedAt - importOp.startedAt
    : performance.now() - importOp.startedAt;
  const duration = formatDuration(elapsed);

  const durationText = importOp.completedAt ? `(${duration})` : `· ${duration}`;

  // Xpub aggregated view
  if (xpubImport) {
    const label = importOp.status === 'active'
      ? `Importing ${xpubImport.childAccountCount} addresses`
      : `Importing ${xpubImport.childAccountCount} addresses`;

    return (
      <Box flexDirection="column">
        <Text>
          {statusIcon(importOp.status)} <Text bold>{label}</Text> <Text dimColor>{durationText}</Text>
        </Text>
        <StreamList streams={xpubImport.aggregatedStreams} />
      </Box>
    );
  }

  // Normal import view
  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(importOp.status)} <Text bold>Importing</Text> <Text dimColor>{durationText}</Text>
      </Text>
      <StreamList streams={importOp.streams} />
    </Box>
  );
};

/**
 * Enhanced StreamList - always show streams (even single stream)
 */
const StreamList: React.FC<{ streams: Map<string, StreamState> }> = ({ streams }) => {
  const streamArray = Array.from(streams.values());

  // Always render stream tree, even if only one stream
  return (
    <Box flexDirection="column">
      {streamArray.map((stream, index) => {
        const isLast = index === streamArray.length - 1;
        return <StreamLine key={stream.name} stream={stream} isLast={isLast} />;
      })}
    </Box>
  );
};

/**
 * Enhanced Dashboard component
 */
export const Dashboard: React.FC<DashboardProps> = ({ state }) => {
  return (
    <Box flexDirection="column">
      <Text> </Text>

      {/* Account info */}
      {state.account && (
        <AccountLine
          accountId={state.account.id}
          isNewAccount={state.account.isNewAccount}
          isXpubParent={state.account.isXpubParent}
          childAccountCount={state.account.childAccountCount}
          transactionCounts={state.account.transactionCounts}
        />
      )}

      {/* Derivation operation (xpub only) */}
      {state.derivation && <DerivationSection derivation={state.derivation} />}

      {/* Provider readiness */}
      {state.providerReadiness && (
        <Text>
          <Text color="green">✓</Text> {state.providerReadiness.count} providers ready
        </Text>
      )}

      {/* Import operation */}
      {state.import && <ImportSection import={state.import} xpubImport={state.xpubImport} />}

      {/* Processing operation */}
      {state.processing && <ProcessingSection processing={state.processing} />}

      {/* Completion status */}
      {state.isComplete && <CompletionSection state={state} />}

      {/* API calls footer */}
      <ApiFooter state={state} />
    </Box>
  );
};
```

## Database Schema Changes

### Account Metadata for Xpub

```typescript
// File: packages/data/src/migrations/001_initial_schema.ts

// Add metadata JSON column to accounts table for xpub derivation metadata

interface AccountMetadata {
  xpub?: {
    gapLimit: number; // Last gap limit used for derivation
    lastDerivedAt: number; // Timestamp of last derivation
    derivedCount: number; // Number of addresses derived
  };
}
```

Schema update required:

- Add `metadata` JSON column to `accounts` table in `packages/data/src/migrations/001_initial_schema.ts`
- Add `metadata` to `AccountsTable` in `packages/data/src/schema/database-schema.ts`
- Add `metadata` to `AccountSchema` in `packages/core/src/schemas/account.ts`

## Implementation Checklist

### Phase 1: Event Infrastructure

- [ ] Add new event types to `packages/ingestion/src/events.ts`
  - [ ] `xpub.derivation.started`
  - [ ] `xpub.derivation.completed`
  - [ ] `xpub.derivation.failed`
  - [ ] `xpub.import.started`
  - [ ] `xpub.import.completed`
  - [ ] `xpub.import.failed`
  - [ ] `xpub.empty`
- [ ] Add `parentAccountId` field to `ImportStartedEvent`
- [ ] Add `parentIsNew` field to `xpub.derivation.started`
- [ ] Add `parentIsNew` field to `xpub.import.started`

### Phase 2: Ingestion Layer

- [ ] Update `ImportOrchestrator.importFromXpub()` in `packages/ingestion/src/features/import/import-orchestrator.ts`
  - [ ] Check for existing metadata to determine if re-derivation needed
  - [ ] Emit `xpub.derivation.started` before derivation
  - [ ] Emit `xpub.derivation.completed` after derivation
  - [ ] Emit `xpub.derivation.failed` on derivation error
  - [ ] Emit `xpub.empty` when no addresses found
  - [ ] Emit `xpub.import.started` before child imports
  - [ ] Emit `xpub.import.completed` after all children succeed
  - [ ] Emit `xpub.import.failed` on first child failure
  - [ ] Store derivation metadata in parent account
  - [ ] Add "Reusing existing children" log when skipping derivation
- [ ] Update `ImportExecutor.executeStreamingImport()` in `packages/ingestion/src/features/import/import-service.ts`
  - [ ] Add `parentAccountId: account.parentAccountId` to `import.started` event

### Phase 3: Dashboard State

- [ ] Add new state interfaces to `apps/cli/src/ui/dashboard/dashboard-state.ts`
  - [ ] `DerivationOperation`
  - [ ] `XpubImportWrapper`
  - [ ] Add optional fields to `AccountInfo`
  - [ ] Add optional fields to `DashboardState`
- [ ] Add event handlers to `apps/cli/src/ui/dashboard/dashboard-updater.ts`
  - [ ] `handleXpubDerivationStarted()`
  - [ ] `handleXpubDerivationCompleted()`
  - [ ] `handleXpubDerivationFailed()`
  - [ ] `handleXpubImportStarted()`
  - [ ] `handleXpubImportCompleted()`
  - [ ] `handleXpubImportFailed()`
  - [ ] `handleXpubEmpty()`
  - [ ] Enhance `handleImportStarted()` to check for `parentAccountId`
  - [ ] Enhance `handleImportBatch()` to aggregate when `xpubImport` exists
  - [ ] Update stream-rate calculation to include `xpubImport.aggregatedStreams`
  - [ ] Add cases to `updateStateFromEvent()` switch

### Phase 4: Dashboard Components

- [ ] Update `apps/cli/src/ui/dashboard/dashboard-components.tsx`
  - [ ] Add `DerivationSection` component
  - [ ] Enhance `AccountLine` to show xpub context
  - [ ] Enhance `ImportSection` to handle xpub aggregation
  - [ ] Update `StreamList` to always render (even single stream)
  - [ ] Update `Dashboard` to render derivation section

### Phase 5: Account Repository

- [ ] Add metadata JSON column to accounts schema
  - [ ] `packages/data/src/migrations/001_initial_schema.ts`
  - [ ] `packages/data/src/schema/database-schema.ts`
  - [ ] `packages/core/src/schemas/account.ts`
- [ ] Add metadata update support in `packages/data/src/repositories/account-repository.ts`
  - [ ] Ensure `update()` method handles metadata field
  - [ ] Add helper method `updateMetadata()` if needed

### Phase 6: Testing

- [ ] Unit tests for event emission logic
  - [ ] Test `importFromXpub()` emits correct events
  - [ ] Test re-derivation logic
  - [ ] Test empty xpub warning
  - [ ] Test child import failure handling
- [ ] Unit tests for dashboard state updates
  - [ ] Test each event handler
  - [ ] Test aggregation logic
  - [ ] Test stream display
- [ ] Integration tests
  - [ ] Test end-to-end new xpub import
  - [ ] Test resume xpub (reuse children)
  - [ ] Test re-derivation with increased gap
  - [ ] Test xpub with no active addresses
- [ ] E2E tests with real testnet xpub
  - [ ] Verify derivation
  - [ ] Verify child account creation
  - [ ] Verify transaction import
  - [ ] Verify dashboard rendering

## Edge Cases & Error Handling

### 1. Derivation API Failures

- **Behavior**: Emit `xpub.derivation.failed` and stop import
- **UX**: Show error message with provider stats

### 2. Empty Xpub (No Active Addresses)

- **Behavior**: Emit `xpub.empty` warning, return `ok([])`, skip processing
- **UX**: Show "No active addresses found for xpub" warning

### 3. Child Import Failure

- **Behavior**: Emit `xpub.import.failed`, return error immediately
- **UX**: Show which child account failed, display error message

### 4. Re-Derivation with Increased Gap

- **Behavior**: Re-derive all addresses, update/create child accounts
- **UX**: Show "Re-deriving addresses (gap increased: 20 → 40)"

### 5. Resume with Existing Children

- **Behavior**: Skip derivation, load existing children, proceed to import
- **UX**: Show "Reusing 24 existing child accounts"

### 6. Partial Derivation (Some Addresses Invalid)

- **Behavior**: Log warnings, skip invalid addresses, continue with valid ones
- **UX**: No user-visible impact (logged only)

## Success Criteria

1. ✅ Users see derivation progress with duration
2. ✅ API calls during derivation visible in footer
3. ✅ Xpub parent account context shown throughout
4. ✅ Aggregated view for all child address imports
5. ✅ Stream breakdown always shown (even single streams)
6. ✅ Re-derivation only when `--xpub-gap` increases
7. ✅ Cached children reused when possible
8. ✅ Empty xpub shows warning
9. ✅ Any child failure = entire xpub import fails
