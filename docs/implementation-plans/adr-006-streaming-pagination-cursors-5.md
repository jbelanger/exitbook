## Phase 5: Provider Migration

### 5.1 Migration Order

Roll out streaming to remaining providers:

1. **Week 4: Moralis** (similar to Alchemy)
2. **Week 5: Subscan** (page-based, simpler)
3. **Week 6: NearBlocks, Blockstream, others**

### 5.2 Moralis Implementation

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/moralis/moralis.api-client.ts`

```typescript
@RegisterApiClient({
  // ... existing config ...
  capabilities: {
    supportedOperations: [...],
    supportedCursorTypes: ['pageToken', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { minutes: 5 },
  },
})
export class MoralisApiClient extends BaseApiClient {

  extractCursors(transaction: EvmTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.timestamp) {
      cursors.push({
        type: 'timestamp',
        value: new Date(transaction.timestamp).getTime()
      });
    }

    if (transaction.blockHeight) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    const replayWindow = this.capabilities.replayWindow;
    if (!replayWindow) return cursor;

    if (cursor.type === 'timestamp') {
      const replayMs = (replayWindow.minutes || 0) * 60 * 1000;
      return {
        type: 'timestamp',
        value: Math.max(0, cursor.value - replayMs),
      };
    }

    return cursor;
  }

  async *executeStreaming(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    // Implementation similar to Alchemy but uses Moralis cursor format
    // ...
  }
}
```

### 5.3 Subscan Implementation

**File:** `packages/blockchain-providers/src/blockchains/substrate/providers/subscan/subscan.api-client.ts`

```typescript
@RegisterApiClient({
  // ... existing config ...
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedCursorTypes: ['timestamp', 'blockNumber'],
    preferredCursorType: 'timestamp',
    replayWindow: { minutes: 5, blocks: 10 },
  },
})
export class SubscanApiClient extends BaseApiClient {
  extractCursors(transaction: SubstrateTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.timestamp) {
      cursors.push({
        type: 'timestamp',
        value: new Date(transaction.timestamp).getTime(),
      });
    }

    if (transaction.blockHeight) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    return cursors;
  }

  // Subscan uses simple page numbers, easier to implement
  async *executeStreaming(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<{
    data: TransactionWithRawData<SubstrateTransaction>[];
    cursor: CursorState;
  }> {
    // Start from page 0 or resume from cursor
    let page = 0;
    let totalFetched = resumeCursor?.totalFetched || 0;

    if (resumeCursor) {
      // Calculate page from timestamp if failing over
      // Or use exact page if same provider (future optimization)
    }

    const maxPages = 100;
    const rowsPerPage = 100;

    while (page < maxPages) {
      const body = {
        address: operation.address,
        page: page,
        row: rowsPerPage,
      };

      const result = await this.httpClient.post<SubscanTransfersResponse>('/api/v2/scan/transfers', body, {
        schema: SubscanTransfersResponseSchema,
      });

      if (result.isErr()) {
        yield err(result.error);
        return;
      }

      const response = result.value;
      if (response.code !== 0) {
        yield err(new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`));
        return;
      }

      const transfers = response.data?.transfers || [];
      if (transfers.length === 0) break;

      // Map transfers
      const transactions: TransactionWithRawData<SubstrateTransaction>[] = [];
      for (const transfer of transfers) {
        const mapResult = convertSubscanTransaction(
          transfer,
          {},
          new Set([operation.address]),
          this.chainConfig,
          this.chainConfig.nativeCurrency,
          this.chainConfig.nativeDecimals
        );

        if (mapResult.isOk()) {
          transactions.push({
            raw: transfer,
            normalized: mapResult.value,
          });
        }
      }

      totalFetched += transactions.length;

      // Extract cursors
      const lastTx = transactions[transactions.length - 1];
      const cursors = this.extractCursors(lastTx.normalized);

      const cursorState: CursorState = {
        primary: cursors.find((c) => c.type === 'timestamp')!,
        alternatives: cursors,
        lastTransactionId: lastTx.normalized.id,
        totalFetched,
        metadata: {
          providerName: this.name,
          updatedAt: Date.now(),
          isComplete: transfers.length < rowsPerPage,
        },
      };

      // ✅ Yield Result-wrapped batch
      yield ok({
        data: transactions,
        cursor: cursorState,
      });

      if (transfers.length < rowsPerPage) break;
      page++;
    }
  }
}
```
