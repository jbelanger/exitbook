## Phase 2: Provider Manager - Failover Logic

### 2.1 Cursor Compatibility Helpers

**File:** `packages/blockchain-providers/src/core/provider-manager.ts`

Add private helper methods:

```typescript
/**
 * Check if provider can resume from cursor
 */
private canProviderResume(provider: IBlockchainProvider, cursor: CursorState): boolean {
  const supportedTypes = provider.capabilities.supportedCursorTypes;

  // Check primary cursor
  if (supportedTypes.includes(cursor.primary.type)) {
    // If it's a pageToken, must match provider name
    if (cursor.primary.type === 'pageToken') {
      return cursor.primary.providerName === provider.name;
    }
    return true;
  }

  // Check alternatives
  return cursor.alternatives?.some(alt =>
    supportedTypes.includes(alt.type) &&
    (alt.type !== 'pageToken' || alt.providerName === provider.name)
  ) || false;
}

/**
 * Select best cursor type for provider from available options
 * Priority order: blockNumber > timestamp > txHash > pageToken (for cross-provider)
 */
private selectBestCursorType(
  provider: IBlockchainProvider,
  cursor?: CursorState
): CursorType {
  if (!cursor) return provider.capabilities.preferredCursorType;

  const supportedTypes = provider.capabilities.supportedCursorTypes;
  const allCursors = [cursor.primary, ...(cursor.alternatives || [])];

  // Priority order for cross-provider failover
  const priorityOrder: CursorType[] = ['blockNumber', 'timestamp', 'txHash', 'pageToken'];

  for (const type of priorityOrder) {
    if (supportedTypes.includes(type) && allCursors.some(c => c.type === type)) {
      return type;
    }
  }

  return provider.capabilities.preferredCursorType;
}

/**
 * Find best cursor to use for provider
 */
private findBestCursor(
  provider: IBlockchainProvider,
  cursor: CursorState
): PaginationCursor | undefined {
  const supportedTypes = provider.capabilities.supportedCursorTypes;

  // Try primary first
  if (supportedTypes.includes(cursor.primary.type)) {
    if (cursor.primary.type !== 'pageToken' || cursor.primary.providerName === provider.name) {
      return cursor.primary;
    }
  }

  // Try alternatives
  if (cursor.alternatives) {
    for (const alt of cursor.alternatives) {
      if (supportedTypes.includes(alt.type)) {
        if (alt.type !== 'pageToken' || alt.providerName === provider.name) {
          return alt;
        }
      }
    }
  }

  return undefined;
}
```

### 2.2 Deduplication Window Management

**File:** `packages/blockchain-providers/src/core/provider-manager.ts`

Add helper method to load recent transaction IDs for deduplication:

```typescript
/**
 * Load recent transaction IDs from storage to seed deduplication set
 *
 * When resuming with a replay window, we need to filter out transactions
 * that were already processed. Loading recent IDs prevents duplicates.
 *
 * @param dataSourceId - Data source to load transactions from
 * @param windowSize - Number of recent transactions to load (default: 1000)
 * @returns Set of transaction IDs from the last N transactions
 */
private async loadRecentTransactionIds(
  dataSourceId: number,
  windowSize: number = 1000
): Promise<Set<string>> {
  // TODO: Implement in Phase 2.3
  // Query: SELECT external_id FROM external_transaction_data
  //        WHERE data_source_id = ?
  //        ORDER BY id DESC
  //        LIMIT ?

  // For now, return empty set (Phase 1-2 proof of concept only)
  return new Set<string>();
}
```

**Note:** This is a critical component for production use. Phase 1-2 proof of concept can skip this by ensuring test imports don't resume mid-stream. Phase 2.3 must implement this before any production use.

### 2.3 Streaming Failover Implementation

**File:** `packages/blockchain-providers/src/core/provider-manager.ts`

Add new method alongside existing `executeWithFailover`:

```typescript
/**
 * Execute operation with streaming pagination and intelligent failover
 *
 * Supports:
 * - Mid-pagination provider switching
 * - Cross-provider cursor translation
 * - Automatic deduplication after replay windows
 * - Progress tracking
 */
async *executeWithFailoverStreaming<T>(
  blockchain: string,
  operation: ProviderOperation,
  resumeCursor?: CursorState
): AsyncIterableIterator<Result<FailoverExecutionResult<T> & { cursor: CursorState }, Error>> {
  const providers = this.getProvidersInOrder(blockchain, operation);

  if (providers.length === 0) {
    yield err(
      new ProviderError(
        `No providers available for ${blockchain} operation: ${operation.type}`,
        'NO_PROVIDERS',
        { blockchain, operation: operation.type }
      )
    );
    return;
  }

  let currentCursor = resumeCursor;
  let providerIndex = 0;
  const deduplicationSet = new Set<string>();

  // ✅ CRITICAL: Populate dedup set from recent database transactions to prevent duplicates
  // during replay window (5 blocks/minutes can be dozens of transactions)
  if (resumeCursor) {
    // TODO Phase 2.3: Load recent transaction IDs from storage to seed dedup set
    // For now, only track the last transaction ID (insufficient for production)
    deduplicationSet.add(resumeCursor.lastTransactionId);
  }

  while (providerIndex < providers.length) {
    const provider = providers[providerIndex];

    // Check cursor compatibility
    if (currentCursor && !this.canProviderResume(provider, currentCursor)) {
      const supportedTypes = provider.capabilities.supportedCursorTypes.join(', ');
      logger.warn(
        `Provider ${provider.name} cannot resume from cursor type ${currentCursor.primary.type}. ` +
        `Supported types: ${supportedTypes}. Trying next provider.`
      );
      providerIndex++;
      continue;
    }

    const isFailover = currentCursor && currentCursor.metadata?.providerName !== provider.name;

    logger.info(
      `Using provider ${provider.name} for ${operation.type}` +
      (isFailover
        ? ` (failover from ${currentCursor!.metadata?.providerName}, replay window will be applied)`
        : currentCursor
          ? ` (resuming same provider)`
          : '')
    );

    try {
      const iterator = provider.executeStreaming(operation, currentCursor);

      for await (const batchResult of iterator) {
        // ✅ Check Result wrapper from provider
        if (batchResult.isErr()) {
          logger.error(`Provider ${provider.name} batch failed: ${getErrorMessage(batchResult.error)}`);

          // Record failure and try next provider
          const circuitState = this.getOrCreateCircuitState(provider.name);
          this.circuitStates.set(provider.name, recordFailure(circuitState, Date.now()));
          this.updateHealthMetrics(provider.name, false, 0, getErrorMessage(batchResult.error));

          providerIndex++;
          break; // Break inner loop, continue outer loop to try next provider
        }

        const batch = batchResult.value;

        // Deduplicate (especially important after failover with replay window)
        const deduplicated = batch.data.filter(tx => {
          const id = tx.normalized.id;
          if (deduplicationSet.has(id)) {
            logger.debug(`Skipping duplicate transaction: ${id}`);
            return false;
          }
          deduplicationSet.add(id);
          return true;
        });

        if (deduplicated.length > 0) {
          // ✅ Yield Result-wrapped batch
          yield ok({
            data: deduplicated as unknown as T[],
            providerName: provider.name,
            cursor: batch.cursor,
          });
        }

        currentCursor = batch.cursor;

        // Record success for circuit breaker
        const circuitState = this.getOrCreateCircuitState(provider.name);
        this.circuitStates.set(provider.name, recordSuccess(circuitState, Date.now()));
      }

      logger.info(`Provider ${provider.name} completed successfully`);
      return;

    } catch (error) {
      // ✅ Unexpected errors (outside Result chain) - wrap and yield
      const errorMessage = getErrorMessage(error);
      logger.error(`Provider ${provider.name} failed with unexpected error: ${errorMessage}`);

      // Record failure
      const circuitState = this.getOrCreateCircuitState(provider.name);
      this.circuitStates.set(provider.name, recordFailure(circuitState, Date.now()));
      this.updateHealthMetrics(provider.name, false, 0, errorMessage);

      // Try next provider
      providerIndex++;

      if (providerIndex < providers.length) {
        const nextProvider = providers[providerIndex];
        const bestCursorType = this.selectBestCursorType(nextProvider, currentCursor);
        logger.info(
          `Failing over to ${nextProvider.name}. ` +
          `Will use ${bestCursorType} cursor for resumption.`
        );
      } else {
        // All providers exhausted - yield error
        yield err(
          new ProviderError(
            `All providers exhausted for ${blockchain}. Last error: ${errorMessage}`,
            'ALL_PROVIDERS_FAILED',
            { blockchain, operation: operation.type, lastError: errorMessage }
          )
        );
        return;
      }
    }
  }

  // No compatible providers found
  yield err(
    new ProviderError(
      `No compatible providers found for ${blockchain}`,
      'NO_COMPATIBLE_PROVIDERS',
      { blockchain, operation: operation.type }
    )
  );
}
```

---
