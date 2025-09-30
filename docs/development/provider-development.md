# How to Add a New Blockchain Provider

## 1. Overview

This guide provides a step-by-step walkthrough for adding a new blockchain API provider to the Universal Provider Architecture. The system is designed to be highly extensible, and following these patterns will ensure your new provider integrates seamlessly, benefiting from the built-in resilience, failover, and health monitoring features.

The development process is broken down into two main components:

1.  **The `ApiClient`:** The class responsible for communicating with the external API.
2.  **The `Mapper`:** The class responsible for transforming the API's raw data into our canonical format.

**Total Time Investment:** Approximately 2-4 hours for a developer familiar with the target API.

## 2. Step 1: Planning and API Research

Before writing code, gather the essential information about the API you're integrating.

### A. Define the Provider's Scope

- **Name:** A unique, machine-readable key (e.g., `blockchair`).
- **Blockchain:** The blockchain it serves (e.g., `bitcoin`).
- **Capabilities:** What operations can it perform? (`getRawAddressTransactions`, `getRawAddressBalance`, etc.).
- **Authentication:** Does it require an API key? What is the recommended environment variable name (e.g., `BLOCKCHAIR_API_KEY`)?

### B. Research the API Documentation

- **Endpoints:** What are the base URLs for mainnet/testnet?
- **Rate Limits:** What are the documented requests-per-second/minute?
- **Data Formats:** What is the JSON structure of a successful response? What about an error response?
- **Pagination:** How does the API handle paginated results? (e.g., `page` parameter, cursors).

## 3. Step 2: Implement the `ApiClient`

The `ApiClient` handles all direct communication with the external API. It extends `BaseRegistryProvider` and uses the `@RegisterApiClient` decorator to make itself discoverable to the system.

**File Location:** `packages/import/src/blockchains/<chain>/api/<ProviderName>ApiClient.ts`

**Example: Creating a `BlockchairApiClient` for Bitcoin.**

```typescript
// packages/import/src/blockchains/bitcoin/api/BlockchairApiClient.ts

import { maskAddress } from '@exitbook/shared-utils';
import { BaseRegistryProvider, RegisterApiClient, ProviderOperation } from '@exitbook/import';
// Import raw response types for this specific API
import type { BlockchairRawTransaction, BlockchairAddressInfo } from '../types';

@RegisterApiClient({
  name: 'blockchair',
  blockchain: 'bitcoin',
  displayName: 'Blockchair API',
  description: 'A multi-blockchain explorer with detailed transaction data.',
  type: 'rest',
  requiresApiKey: true, // Let's assume it requires a key
  apiKeyEnvVar: 'BLOCKCHAIR_API_KEY',
  defaultConfig: {
    timeout: 15000,
    retries: 3,
    rateLimit: { requestsPerSecond: 1 },
  },
  networks: {
    mainnet: { baseUrl: 'https://api.blockchair.com/bitcoin' },
  },
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getAddressInfo'],
  },
})
export class BlockchairApiClient extends BaseRegistryProvider {
  constructor() {
    super('bitcoin', 'blockchair', 'mainnet');
  }

  // Universal execute method that routes to specific implementations
  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.validateApiKey(); // Base class helper checks if the API key is present

    switch (operation.type) {
      case 'getRawAddressTransactions':
        return this.getRawAddressTransactions(operation.address) as Promise<T>;
      case 'getAddressInfo':
        return this.getAddressInfo(operation.address) as Promise<T>;
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  // Health check implementation
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<{ data?: unknown }>('/stats');
      return !!response.data;
    } catch {
      return false;
    }
  }

  // --- Private Implementation Methods ---

  private async getRawAddressTransactions(address: string): Promise<BlockchairRawTransaction[]> {
    this.logger.debug(`Fetching raw transactions for ${maskAddress(address)}`);
    // NOTE: The '?key=' part would be handled automatically if we configure the HttpClient
    // to append the API key as a query parameter.
    const endpoint = `/dashboards/address/${address}?transaction_details=true`;
    const response = await this.httpClient.get<{ data: Record<string, { transactions: BlockchairRawTransaction[] }> }>(
      endpoint
    );

    // Navigate the unique structure of the Blockchair response
    return response.data[address]?.transactions || [];
  }

  private async getAddressInfo(address: string): Promise<AddressInfo> {
    this.logger.debug(`Fetching address info for ${maskAddress(address)}`);
    const endpoint = `/dashboards/address/${address}`;
    const response = await this.httpClient.get<{ data: Record<string, { address: BlockchairAddressInfo }> }>(endpoint);
    const info = response.data[address]?.address;

    if (!info) {
      throw new Error('Invalid response structure from Blockchair getAddressInfo');
    }

    return {
      balance: (info.balance / 1e8).toString(), // Convert satoshis to BTC
      txCount: info.transaction_count,
    };
  }
}
```

## 4. Step 3: Implement the `Mapper`

The `Mapper` validates the raw API response and transforms it into the canonical `UniversalBlockchainTransaction` format.

**File Location:** `packages/import/src/blockchains/<chain>/mappers/<ProviderName>Mapper.ts`

**Example: Creating a `BlockchairMapper` for Bitcoin.**

````typescript
// packages/import/src/blockchains/bitcoin/mappers/BlockchairMapper.ts

import { BaseRawDataMapper, RegisterTransactionMapper, UniversalBlockchainTransaction } from '@exitbook/import';
import { ZodSchema, z } from 'zod';
import { Result, ok, err } from 'neverthrow';

// 1. Define Zod schemas for the raw API response to ensure data integrity
const BlockchairRawTxSchema = z.object({
  hash: z.string(),
  time: z.string(),
  balance_change: z.number(),
  fee: z.number(),
  block_id: z.number(),
  // ... other fields
});

type BlockchairRawTransaction = z.infer<typeof BlockchairRawTxSchema>;

@RegisterTransactionMapper('blockchair') // Name must match the ApiClient's name
export class BlockchairMapper extends BaseRawDataMapper<BlockchairRawTransaction> {
  // 2. Assign the schema for automatic validation by the base class
  protected readonly schema: ZodSchema = BlockchairRawTxSchema;

  // 3. Implement the transformation logic
  protected mapInternal(
    rawData: BlockchairRawTransaction,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {

    const addresses = new Set(sessionContext.derivedAddresses || [sessionContext.address]);
    const isOutgoing = rawData.balance_change < 0;

    // This is a simplified transformation logic. A real one would determine from/to addresses.
    const transaction: UniversalBlockchainTransaction = {
      id: rawData.hash,
      providerId: 'blockchair',
      timestamp: new Date(rawData.time).getTime(),
      blockHeight: rawData.block_id,
      status: 'success',
      amount: (Math.abs(rawData.balance_change) / 1e8).toString(),
      currency: 'BTC',
      feeAmount: (rawData.fee / 1e8).toString(),
      feeCurrency: 'BTC',
      from: isOutgoing ? sessionContext.address || '' : 'unknown',
      to: isOutgoing ? 'unknown' : sessionContext.address || '',
      type: 'transfer',
    };

    return ok([transaction]);
  }
}```

## 5. Step 4: Register and Deploy

### A. Trigger Registration

To make your new components discoverable, import them into their respective `index.ts` files. This ensures their decorators run when the application starts.

```typescript
// packages/import/src/blockchains/bitcoin/api/index.ts
import './BlockchairApiClient.ts'; // <-- ADD THIS LINE
import './MempoolSpaceApiClient.ts';
// ...
````

```typescript
// packages/import/src/blockchains/bitcoin/mappers/index.ts
import './BlockchairMapper.ts'; // <-- ADD THIS LINE
import './MempoolSpaceMapper.ts';
// ...
```

### B. Sync and Configure

The system can now see your new provider.

1.  **Sync the Configuration:** Run the script to automatically add "blockchair" to your config file.
    ```bash
    pnpm --filter @exitbook/import run providers:sync --fix
    ```
2.  **Set API Key:** If your provider requires an API key, add it to your `.env` file.
    ```env
    # .env
    BLOCKCHAIR_API_KEY="your_api_key_here"
    ```
3.  **Validate:** Run the config validator to ensure everything is set up correctly.
    ```bash
    pnpm --filter @exitbook/import run config:validate
    ```

## 6. Step 5: Write Comprehensive Tests

Testing is crucial for ensuring the reliability of a new provider.

### A. Unit Test the `Mapper`

Focus on the transformation logic. Provide sample raw JSON data and assert that the output `UniversalBlockchainTransaction` is correct.

**File Location:** `packages/import/src/blockchains/bitcoin/mappers/BlockchairMapper.test.ts`

```typescript
// Example test for the mapper
import { BlockchairMapper } from './BlockchairMapper';

describe('BlockchairMapper', () => {
  const mapper = new BlockchairMapper();
  const sessionContext = { address: 'user_address_1' };

  it('should correctly map an outgoing transaction', () => {
    const rawTx = { hash: 'tx1', time: '2023-01-01T12:00:00Z', balance_change: -50000, fee: 1000, block_id: 800000 };

    const result = mapper.map(rawTx, sessionContext);

    expect(result.isOk()).toBe(true);
    const tx = result._unsafeUnwrap()[0];
    expect(tx.amount).toBe('0.0005');
    expect(tx.feeAmount).toBe('0.00001');
    expect(tx.from).toBe('user_address_1');
  });

  it('should return an error for invalid raw data', () => {
    const invalidRawTx = { hash: 'tx1' }; // Missing required fields

    const result = mapper.map(invalidRawTx, sessionContext);
    expect(result.isErr()).toBe(true);
  });
});
```

### B. Integration Test the `ApiClient`

Focus on the `ApiClient`'s interaction with the `HttpClient` and its ability to handle different API responses. Use the `createHoistedHttpClientMock` to mock `fetch` requests.

**File Location:** `packages/import/src/blockchains/bitcoin/api/BlockchairApiClient.test.ts`

```typescript
// Example test for the API Client
import { createHoistedHttpClientMock } from '../../../shared/test-utils/http-client-mock';
import { BlockchairApiClient } from './BlockchairApiClient';

// Hoist mocks to the top
const mocks = vi.hoisted(() => createHoistedHttpClientMock());
vi.mock('@exitbook/shared-utils', () => mocks.getModuleMocks()['@exitbook/shared-utils']);
vi.mock('@exitbook/shared-logger', () => mocks.getModuleMocks()['@exitbook/shared-logger']);

describe('BlockchairApiClient', () => {
  beforeEach(() => {
    mocks.mockHttpClient.request.mockClear();
  });

  it('should fetch and return raw transactions', async () => {
    // Mock a successful API response
    const mockApiResponse = { data: { 'test-address': { transactions: [{ hash: 'tx1' }] } } };
    mocks.mockHttpClient.request.mockResolvedValue(mockApiResponse);

    const client = new BlockchairApiClient();
    const transactions = await client.execute({ type: 'getRawAddressTransactions', address: 'test-address' });

    // Assert that the correct endpoint was called
    expect(mocks.mockHttpClient.request).toHaveBeenCalledWith(
      expect.stringContaining('/dashboards/address/test-address'),
      expect.anything()
    );
    // Assert that the data was returned correctly
    expect(transactions).toEqual([{ hash: 'tx1' }]);
  });
});
```

## 7. Conclusion

By adhering to this structure, you contribute a new provider that is not only functional but also inherently resilient, maintainable, and well-integrated into the platform's ecosystem. The combination of decorators for metadata, separate mappers for transformation logic, and a robust base class system makes the process of extending the platform's data capabilities both efficient and reliable.
