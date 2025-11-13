## Phase 3: Proof-of-Concept Provider (Alchemy)

### 3.1 Update Capabilities Declaration

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

Update `@RegisterApiClient` decorator:

```typescript
@RegisterApiClient({
  // ... existing config ...
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressInternalTransactions',
      'getAddressBalances',
      'getAddressTokenTransactions',
      'getAddressTokenBalances',
    ],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 5, minutes: 5 },
  },
})
export class AlchemyApiClient extends BaseApiClient {
  // ...
}
```

### 3.2 Implement Cursor Extraction

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

```typescript
extractCursors(transaction: EvmTransaction): PaginationCursor[] {
  const cursors: PaginationCursor[] = [];

  if (transaction.blockHeight !== undefined) {
    cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
  }

  if (transaction.timestamp) {
    cursors.push({
      type: 'timestamp',
      value: new Date(transaction.timestamp).getTime()
    });
  }

  return cursors;
}
```

### 3.3 Implement Replay Window

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

```typescript
applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
  const replayWindow = this.capabilities.replayWindow;
  if (!replayWindow) return cursor;

  switch (cursor.type) {
    case 'blockNumber':
      return {
        type: 'blockNumber',
        value: Math.max(0, cursor.value - (replayWindow.blocks || 0)),
      };

    case 'timestamp':
      const replayMs = (replayWindow.minutes || 0) * 60 * 1000;
      return {
        type: 'timestamp',
        value: Math.max(0, cursor.value - replayMs),
      };

    default:
      return cursor;
  }
}
```

### 3.4 Implement Streaming Execution

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

Replace `getAssetTransfersPaginated` with streaming version:

```typescript
async *executeStreaming(
  operation: ProviderOperation,
  resumeCursor?: CursorState
): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
  // Only handle getAddressTransactions for now (proof of concept)
  if (operation.type !== 'getAddressTransactions') {
    yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
    return;
  }

  const address = operation.address;

  // Determine starting point
  let pageKey: string | undefined;
  let fromBlock: string | undefined;
  let totalFetched = resumeCursor?.totalFetched || 0;

  if (resumeCursor) {
    // Priority 1: Use pageToken from same provider (most efficient)
    if (resumeCursor.primary.type === 'pageToken' &&
        resumeCursor.primary.providerName === this.name) {
      pageKey = resumeCursor.primary.value;
      this.logger.info(`Resuming from Alchemy pageKey: ${pageKey}`);
    }
    // Priority 2: Use blockNumber cursor (cross-provider failover)
    else {
      const blockCursor = resumeCursor.primary.type === 'blockNumber'
        ? resumeCursor.primary
        : resumeCursor.alternatives?.find(c => c.type === 'blockNumber');

      if (blockCursor && blockCursor.type === 'blockNumber') {
        const adjusted = this.applyReplayWindow(blockCursor);
        fromBlock = `0x${adjusted.value.toString(16)}`;
        this.logger.info(`Resuming from block ${adjusted.value} (with replay window)`);
      } else {
        this.logger.warn('No compatible cursor found, starting from beginning');
      }
    }
  }

  const deduplicationSet = new Set<string>();
  if (resumeCursor?.lastTransactionId) {
    deduplicationSet.add(resumeCursor.lastTransactionId);
  }

  let pageCount = 0;
  const maxPages = 100;

  while (pageCount < maxPages) {
    // Fetch transfers FROM address (outgoing)
    const fromParams: AlchemyAssetTransferParams = {
      category: ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
      excludeZeroValue: false,
      fromAddress: address,
      fromBlock: fromBlock || '0x0',
      maxCount: '0x3e8', // 1000
      toBlock: 'latest',
      withMetadata: true,
      ...(pageKey && { pageKey }),
    };

    const fromResult = await this.httpClient.post(
      `/${this.apiKey}`,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [fromParams],
      },
      { schema: AlchemyAssetTransfersJsonRpcResponseSchema }
    );

    if (fromResult.isErr()) {
      yield err(fromResult.error);
      return;
    }

    const fromResponse = fromResult.value;
    const fromTransfers = fromResponse.result?.transfers || [];

    // Fetch transfers TO address (incoming)
    const toParams: AlchemyAssetTransferParams = {
      category: ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
      excludeZeroValue: false,
      toAddress: address,
      fromBlock: fromBlock || '0x0',
      maxCount: '0x3e8',
      toBlock: 'latest',
      withMetadata: true,
      ...(pageKey && { pageKey }),
    };

    const toResult = await this.httpClient.post(
      `/${this.apiKey}`,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [toParams],
      },
      { schema: AlchemyAssetTransfersJsonRpcResponseSchema }
    );

    if (toResult.isErr()) {
      yield err(toResult.error);
      return;
    }

    const toResponse = toResult.value;
    const toTransfers = toResponse.result?.transfers || [];

    const allTransfers = [...fromTransfers, ...toTransfers];

    if (allTransfers.length === 0) break;

    // Map and deduplicate
    const mappedTransfers = allTransfers
      .map(t => mapAlchemyTransaction(t, this.chainConfig))
      .filter(tx => {
        if (deduplicationSet.has(tx.normalized.id)) {
          this.logger.debug(`Skipping duplicate: ${tx.normalized.id}`);
          return false;
        }
        deduplicationSet.add(tx.normalized.id);
        return true;
      });

    totalFetched += mappedTransfers.length;

    // Extract cursors from last transaction
    const lastTx = mappedTransfers[mappedTransfers.length - 1];
    const cursors = this.extractCursors(lastTx.normalized);

    // Build cursor state
    const cursorState: CursorState = {
      primary: fromResponse.result?.pageKey
        ? { type: 'pageToken', value: fromResponse.result.pageKey, providerName: this.name }
        : cursors.find(c => c.type === 'blockNumber')!,
      alternatives: cursors,
      lastTransactionId: lastTx.normalized.id,
      totalFetched,
      metadata: {
        providerName: this.name,
        updatedAt: Date.now(),
        isComplete: !fromResponse.result?.pageKey && !toResponse.result?.pageKey,
      },
    };

    // ✅ Yield Result-wrapped batch
    yield ok({
      data: mappedTransfers,
      cursor: cursorState,
    });

    pageKey = fromResponse.result?.pageKey || toResponse.result?.pageKey;
    if (!pageKey) break;
    pageCount++;
  }
}
```

**CRITICAL PATTERN:**

All errors in the streaming path are **yielded** as `err(Error)`, not thrown:

```typescript
// ❌ WRONG - throws, bypasses Result contract
if (fromResult.isErr()) {
  throw fromResult.error;
}

// ✅ CORRECT - yields err() and returns
if (fromResult.isErr()) {
  yield err(fromResult.error);
  return;
}

// ✅ CORRECT - wraps success in ok()
yield ok({
  data: mappedTransfers,
  cursor: cursorState,
});
```

This maintains consistency with neverthrow pattern throughout the repository.

````

### 3.5 Keep Legacy Method (Temporarily)

Mark old method as deprecated but keep functional:

```typescript
/**
 * @deprecated Use executeStreaming instead
 */
async execute<T>(operation: ProviderOperation, options: Record<string, unknown>): Promise<Result<T, Error>> {
  // Existing implementation unchanged
  // Will be removed in Phase 4 after all providers migrated
}
````

---
