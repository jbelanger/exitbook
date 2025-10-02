import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../shared/index.ts';
import { ThetaExplorerApiClient } from '../theta-explorer.api-client.js';
import { ThetaExplorerTransactionMapper } from '../theta-explorer.mapper.js';
import type { ThetaTransaction } from '../theta-explorer.types.js';

describe('ThetaExplorerTransactionMapper E2E', () => {
  const mapper = new ThetaExplorerTransactionMapper();
  const config = ProviderRegistry.createDefaultConfig('theta', 'theta-explorer');
  const apiClient = new ThetaExplorerApiClient(config);
  // Theta Labs deployer address - known to have transactions
  const testAddress = '0x2E833968E5bB786Ae419c4d13189fB081Cc43bab';

  let cachedTransactions: ThetaTransaction[];

  beforeAll(async () => {
    // Fetch data once to avoid hammering the API
    cachedTransactions = await apiClient.execute<ThetaTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });
  }, 60000);

  it('should map real transaction data from API', () => {
    expect(cachedTransactions.length).toBeGreaterThan(0);

    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.id).toBe(rawTx.hash);
      expect(normalized.currency).toBeDefined();
      expect(['THETA', 'TFUEL']).toContain(normalized.currency);
      expect(normalized.providerId).toBe('theta-explorer');
      expect(normalized.status).toBe('success');
      expect(normalized.from).toBeDefined();
      expect(normalized.to).toBeDefined();
      expect(normalized.timestamp).toBeGreaterThan(0);
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should map send transactions (type 2) correctly', () => {
    const sendTx = cachedTransactions.find((tx) => tx.type === 2);
    if (!sendTx) {
      console.warn('No send transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(sendTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(['THETA', 'TFUEL']).toContain(normalized.currency);
      expect(normalized.type).toBe('transfer');
      expect(normalized.tokenType).toBe('native');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
      expect(normalized.from).toBeDefined();
      expect(normalized.to).toBeDefined();
    }
  });

  it('should map smart contract transactions (type 7) correctly', () => {
    const contractTx = cachedTransactions.find((tx) => tx.type === 7);
    if (!contractTx) {
      console.warn('No smart contract transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(contractTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(['THETA', 'TFUEL']).toContain(normalized.currency);
      expect(normalized.type).toBe('transfer');
      expect(normalized.tokenType).toBe('native');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
      expect(normalized.from).toBeDefined();
      expect(normalized.to).toBeDefined();
    }
  });

  it('should handle TFUEL transactions correctly', () => {
    // Find a transaction with TFUEL
    let tfuelTx: ThetaTransaction | undefined;
    for (const tx of cachedTransactions) {
      if (tx.type === 2) {
        const data = tx.data as {
          source?: { coins?: { tfuelwei: string } };
          target?: { coins?: { tfuelwei: string } };
        };
        const tfuelWei = data.target?.coins?.tfuelwei || data.source?.coins?.tfuelwei;
        if (tfuelWei && parseInt(tfuelWei) > 0) {
          tfuelTx = tx;
          break;
        }
      }
    }

    if (!tfuelTx) {
      console.warn('No TFUEL transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(tfuelTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.currency).toBe('TFUEL');
      expect(parseFloat(normalized.amount)).toBeGreaterThan(0);
    }
  });

  it('should handle THETA transactions correctly', () => {
    // Find a transaction with THETA
    let thetaTx: ThetaTransaction | undefined;
    for (const tx of cachedTransactions) {
      if (tx.type === 2) {
        const data = tx.data as {
          source?: { coins?: { thetawei: string } };
          target?: { coins?: { thetawei: string } };
        };
        const thetaWei = data.target?.coins?.thetawei || data.source?.coins?.thetawei;
        if (thetaWei && parseInt(thetaWei) > 0) {
          thetaTx = tx;
          break;
        }
      }
    }

    if (!thetaTx) {
      console.warn('No THETA transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(thetaTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.currency).toBe('THETA');
      expect(parseFloat(normalized.amount)).toBeGreaterThan(0);
    }
  });

  it('should map transaction timestamps correctly', () => {
    const txWithTimestamp = cachedTransactions[0];
    if (!txWithTimestamp) {
      console.warn('No transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithTimestamp, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.timestamp).toBeGreaterThan(0);
      // Timestamp should be a valid date in milliseconds
      const date = new Date(normalized.timestamp);
      expect(date.getTime()).toBeGreaterThan(0);
      // Should be after Theta mainnet launch (2019)
      expect(date.getFullYear()).toBeGreaterThanOrEqual(2019);
    }
  });

  it('should map block height correctly', () => {
    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      // block_height is a numeric string, should be parsed to number
      expect(normalized.blockHeight).toBe(parseInt(rawTx.block_height));
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should reject unsupported transaction types', () => {
    // Find a transaction with unsupported type (not 2 or 7)
    const unsupportedTx = cachedTransactions.find((tx) => tx.type !== 2 && tx.type !== 7);
    if (!unsupportedTx) {
      console.warn('No unsupported transaction types found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(unsupportedTx, metadata, sessionContext);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Unsupported transaction type');
    }
  });

  it('should extract from/to addresses correctly', () => {
    const rawTx = cachedTransactions.find((tx) => tx.type === 2 || tx.type === 7);
    if (!rawTx) {
      console.warn('No transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'theta-explorer',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      // Addresses should be valid Ethereum-style addresses
      expect(normalized.from).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(normalized.to).toMatch(/^0x[a-fA-F0-9]+$/);
    }
  });
});
