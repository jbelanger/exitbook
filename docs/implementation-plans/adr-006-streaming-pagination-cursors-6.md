## Phase 6: Testing

### 6.1 Unit Tests - Cursor System

**File:** `packages/blockchain-providers/src/core/types/__tests__/cursor.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import type { PaginationCursor, CursorState } from '../cursor.js';

describe('Cursor Types', () => {
  describe('PaginationCursor', () => {
    it('should support blockNumber cursor', () => {
      const cursor: PaginationCursor = { type: 'blockNumber', value: 15000000 };
      expect(cursor.type).toBe('blockNumber');
      expect(cursor.value).toBe(15000000);
    });

    it('should support timestamp cursor', () => {
      const cursor: PaginationCursor = { type: 'timestamp', value: 1640000000000 };
      expect(cursor.type).toBe('timestamp');
    });

    it('should support txHash cursor', () => {
      const cursor: PaginationCursor = { type: 'txHash', value: '0xabc123' };
      expect(cursor.type).toBe('txHash');
    });

    it('should support pageToken with providerName', () => {
      const cursor: PaginationCursor = {
        type: 'pageToken',
        value: 'xyz789',
        providerName: 'alchemy',
      };
      expect(cursor.type).toBe('pageToken');
      expect(cursor.providerName).toBe('alchemy');
    });
  });

  describe('CursorState', () => {
    it('should contain primary and alternative cursors', () => {
      const state: CursorState = {
        primary: { type: 'pageToken', value: 'xyz', providerName: 'alchemy' },
        alternatives: [
          { type: 'blockNumber', value: 15000000 },
          { type: 'timestamp', value: 1640000000000 },
        ],
        lastTransactionId: 'tx-123',
        totalFetched: 500,
        metadata: {
          providerName: 'alchemy',
          updatedAt: Date.now(),
          isComplete: false,
        },
      };

      expect(state.alternatives).toHaveLength(2);
      expect(state.totalFetched).toBe(500);
    });

    it('should serialize and deserialize correctly', () => {
      const state: CursorState = {
        primary: { type: 'blockNumber', value: 100 },
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      const serialized = JSON.stringify(state);
      const deserialized = JSON.parse(serialized) as CursorState;

      expect(deserialized.primary.type).toBe('blockNumber');
      expect(deserialized.totalFetched).toBe(10);
    });
  });
});
```

### 6.2 Unit Tests - Provider Manager

**File:** `packages/blockchain-providers/src/core/__tests__/provider-manager-streaming.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlockchainProviderManager } from '../provider-manager.js';
import type { IBlockchainProvider, CursorState } from '../types/index.js';

describe('ProviderManager - Streaming', () => {
  let manager: BlockchainProviderManager;

  beforeEach(() => {
    manager = new BlockchainProviderManager(undefined);
  });

  describe('Cursor Compatibility', () => {
    it('should accept provider with matching cursor type', () => {
      const provider: IBlockchainProvider = {
        name: 'test-provider',
        blockchain: 'ethereum',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedCursorTypes: ['blockNumber', 'timestamp'],
          preferredCursorType: 'blockNumber',
        },
        executeStreaming: vi.fn(),
        extractCursors: vi.fn(),
        applyReplayWindow: vi.fn(),
        execute: vi.fn(),
      };

      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 100 },
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      // Access private method via type assertion for testing
      const canResume = (manager as any).canProviderResume(provider, cursor);
      expect(canResume).toBe(true);
    });

    it('should reject provider with incompatible cursor type', () => {
      const provider: IBlockchainProvider = {
        name: 'test-provider',
        blockchain: 'ethereum',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedCursorTypes: ['pageToken'],
          preferredCursorType: 'pageToken',
        },
        executeStreaming: vi.fn(),
        extractCursors: vi.fn(),
        applyReplayWindow: vi.fn(),
        execute: vi.fn(),
      };

      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 100 },
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      const canResume = (manager as any).canProviderResume(provider, cursor);
      expect(canResume).toBe(false);
    });

    it('should accept provider if alternative cursor matches', () => {
      const provider: IBlockchainProvider = {
        name: 'test-provider',
        blockchain: 'ethereum',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedCursorTypes: ['timestamp'],
          preferredCursorType: 'timestamp',
        },
        executeStreaming: vi.fn(),
        extractCursors: vi.fn(),
        applyReplayWindow: vi.fn(),
        execute: vi.fn(),
      };

      const cursor: CursorState = {
        primary: { type: 'pageToken', value: 'xyz', providerName: 'alchemy' },
        alternatives: [{ type: 'timestamp', value: 1640000000000 }],
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      const canResume = (manager as any).canProviderResume(provider, cursor);
      expect(canResume).toBe(true);
    });
  });

  describe('Failover', () => {
    it('should switch providers mid-pagination', async () => {
      // Test implementation for failover scenario
      // Mock first provider to fail after 2 batches
      // Mock second provider to continue from cursor
      // Verify deduplication works
    });
  });
});
```

### 6.3 Integration Tests

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/__tests__/alchemy-streaming.e2e.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { AlchemyApiClient } from '../alchemy.api-client.js';

describe('Alchemy - Streaming E2E', () => {
  it('should stream transactions with cursor', async () => {
    const client = new AlchemyApiClient({
      blockchain: 'ethereum',
      name: 'alchemy',
      baseUrl: 'https://eth-mainnet.g.alchemy.com/v2',
      apiKey: process.env.ALCHEMY_API_KEY!,
    });

    const batches: any[] = [];
    const iterator = client.executeStreaming({
      type: 'getAddressTransactions',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    });

    let batchCount = 0;
    for await (const batch of iterator) {
      batches.push(batch);
      batchCount++;

      // Verify cursor exists
      expect(batch.cursor).toBeDefined();
      expect(batch.cursor.primary).toBeDefined();
      expect(batch.cursor.lastTransactionId).toBeDefined();

      if (batchCount >= 3) break; // Test first 3 batches
    }

    expect(batches.length).toBeGreaterThan(0);
  });

  it('should resume from cursor', async () => {
    // Test resumability
    // 1. Fetch first 2 batches
    // 2. Save cursor from batch 2
    // 3. Create new client instance
    // 4. Resume from saved cursor
    // 5. Verify no duplicates
  });
});
```

**File:** `packages/ingestion/src/infrastructure/blockchains/evm/__tests__/importer-streaming.test.ts`

Add regression test to ensure all transaction categories stream:

```typescript
it('streams normal, internal, and token batches', async () => {
  const importer = new EvmImporter(chainConfig, providerManager);
  mockProviderManager(providerManager, [
    { op: 'getAddressTransactions', transactions: fakeNormalTxs },
    { op: 'getAddressInternalTransactions', transactions: fakeInternalTxs },
    { op: 'getAddressTokenTransactions', transactions: fakeTokenTxs },
  ]);

  const hints: string[] = [];
  for await (const batchResult of importer.importStreaming({ address: '0xabc' })) {
    expect(batchResult.isOk()).toBe(true);
    hints.push(...batchResult.value.rawTransactions.map((tx) => tx.transactionTypeHint!));
  }

  expect(hints).toEqual(['normal', 'internal', 'token']);
});
```

---
