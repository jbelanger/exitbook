import type { RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import { ThetaScanApiClient } from '../thetascan.api-client.js';
import { ThetaScanTransactionMapper } from '../thetascan.mapper.js';
import type { ThetaScanTransaction } from '../thetascan.types.js';

describe('ThetaScanTransactionMapper E2E', () => {
  const mapper = new ThetaScanTransactionMapper();
  const config = ProviderRegistry.createDefaultConfig('theta', 'thetascan');
  const apiClient = new ThetaScanApiClient(config);
  // Example Theta address - you can replace with a known address
  const testAddress = '0x2E833968E5bB786Ae419c4d13189fB081Cc43bab';

  let cachedTransactions: ThetaScanTransaction[];

  beforeAll(async () => {
    // Fetch data once to avoid hammering the API
    cachedTransactions = await apiClient.execute<ThetaScanTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });
  }, 60000);

  it('should map real transaction data from API', () => {
    expect(cachedTransactions.length).toBeGreaterThan(0);

    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.id).toBe(rawTx.hash);
      expect(['THETA', 'TFUEL']).toContain(normalized.currency);
      expect(normalized.providerId).toBe('thetascan');
      expect(normalized.status).toBe('success');
      expect(normalized.from).toBe(rawTx.sending_address);
      expect(normalized.to).toBe(rawTx.recieving_address);
      expect(normalized.timestamp).toBeGreaterThan(0);
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should prioritize THETA over TFUEL when both are present', () => {
    const thetaTransfer = cachedTransactions.find((tx) => {
      const theta = parseFloat(tx.theta.replace(/,/g, ''));
      return theta > 0;
    });

    if (!thetaTransfer) {
      console.warn('No THETA transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(thetaTransfer, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.currency).toBe('THETA');
      expect(normalized.tokenSymbol).toBe('THETA');
      // THETA transfers are mapped as token_transfer to preserve currency
      expect(normalized.type).toBe('token_transfer');
      expect(normalized.tokenType).toBe('native');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThan(0);
    }
  });

  it('should map TFUEL transactions correctly', () => {
    const tfuelTransfer = cachedTransactions.find((tx) => {
      const theta = parseFloat(tx.theta.replace(/,/g, ''));
      const tfuel = parseFloat(tx.tfuel.replace(/,/g, ''));
      return theta === 0 && tfuel > 0;
    });

    if (!tfuelTransfer) {
      console.warn('No TFUEL-only transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(tfuelTransfer, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.currency).toBe('TFUEL');
      expect(normalized.tokenSymbol).toBe('TFUEL');
      expect(normalized.type).toBe('transfer');
      expect(normalized.tokenType).toBe('native');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThan(0);
    }
  });

  it('should map fees correctly (always in TFUEL)', () => {
    const txWithFee = cachedTransactions.find((tx) => tx.fee_tfuel > 0);

    if (!txWithFee) {
      console.warn('No transactions with fees found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithFee, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.feeCurrency).toBe('TFUEL');
      expect(normalized.feeAmount).toBeDefined();
      // Fee should be greater than 0
      expect(parseFloat(normalized.feeAmount!)).toBeGreaterThan(0);
    }
  });

  it('should map transaction timestamps correctly', () => {
    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.timestamp).toBeGreaterThan(0);
      // Timestamp should be a valid date
      const date = new Date(normalized.timestamp);
      expect(date.getTime()).toBeGreaterThan(0);
    }
  });

  it('should map block height correctly', () => {
    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      // Block is a string that should be parsed to a number
      expect(normalized.blockHeight).toBe(parseInt(rawTx.block));
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should handle zero-value transactions', () => {
    const zeroValueTx = cachedTransactions.find((tx) => {
      const theta = parseFloat(tx.theta.replace(/,/g, ''));
      const tfuel = parseFloat(tx.tfuel.replace(/,/g, ''));
      return theta === 0 && tfuel === 0;
    });

    if (!zeroValueTx) {
      console.warn('No zero-value transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(zeroValueTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      // Should default to TFUEL for zero-value transactions
      expect(normalized.currency).toBe('TFUEL');
      expect(normalized.amount).toBe('0');
    }
  });

  it('should handle amounts with comma formatting', () => {
    // ThetaScan uses "1,000,000.000000" format for amounts
    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      // Amount should be a valid number string without commas
      expect(normalized.amount).not.toContain(',');
      // Should be convertible to a number
      expect(() => parseFloat(normalized.amount)).not.toThrow();
    }
  });

  it('should handle amount conversion based on currency type', () => {
    const thetaTx = cachedTransactions.find((tx) => {
      const theta = parseFloat(tx.theta.replace(/,/g, ''));
      return theta > 0;
    });

    const tfuelTx = cachedTransactions.find((tx) => {
      const theta = parseFloat(tx.theta.replace(/,/g, ''));
      const tfuel = parseFloat(tx.tfuel.replace(/,/g, ''));
      return theta === 0 && tfuel > 0;
    });

    const metadata: RawTransactionMetadata = {
      providerId: 'thetascan',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    // Test THETA: should be normalized (may contain decimals)
    if (thetaTx) {
      const result = mapper.map(thetaTx, metadata, sessionContext);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('THETA');
        // THETA amounts are normalized (not wei), so may have decimals
        const rawAmount = parseFloat(thetaTx.theta.replace(/,/g, ''));
        expect(parseFloat(normalized.amount)).toBeCloseTo(rawAmount, 4);
      }
    }

    // Test TFUEL: should be in wei (no decimals, large integers)
    if (tfuelTx) {
      const result = mapper.map(tfuelTx, metadata, sessionContext);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('TFUEL');
        // TFUEL amounts should be in wei (no decimals)
        expect(normalized.amount).not.toContain('.');
        // Should be a large integer for any non-zero amount
        if (parseFloat(normalized.amount) > 0) {
          expect(normalized.amount.length).toBeGreaterThan(10);
        }
      }
    }

    if (!thetaTx && !tfuelTx) {
      console.warn('No transactions with amounts found, skipping test');
    }
  });
});
