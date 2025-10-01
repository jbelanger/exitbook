import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../shared/index.ts';
import { TaostatsApiClient } from '../taostats.api-client.ts';
import type { TaostatsBalanceResponse, TaostatsTransactionAugmented } from '../taostats.types.ts';

describe('TaostatsApiClient Integration - Bittensor', () => {
  describe('Bittensor', () => {
    const config = ProviderRegistry.createDefaultConfig('bittensor', 'taostats');
    const provider = new TaostatsApiClient(config);
    // Test address with minimal transaction history to avoid rate limits
    const testAddress = '5HEo565WAy4Dbq3Sv271SAi7syBSofyfhhwRNjFNSM2gP9M2';

    beforeAll(() => {
      if (!process.env.TAOSTATS_API_KEY) {
        console.warn('⚠️  TAOSTATS_API_KEY not set - tests may fail. Add to apps/cli/.env');
      }
    });

    describe('Health Checks', () => {
      it('should check API health', async () => {
        const result = await provider.isHealthy();
        // Health check endpoint may not exist, but we expect a result (ok or err)
        expect(result.isOk()).toBe(true);
      }, 30000);
    });

    describe('Raw Address Balance', () => {
      it('should fetch raw address balance successfully', async () => {
        const response = await provider.execute<TaostatsBalanceResponse>({
          address: testAddress,
          type: 'getRawAddressBalance',
        });

        expect(response).toHaveProperty('data');
        expect(Array.isArray(response.data)).toBe(true);
        expect(response.data!.length).toBeGreaterThan(0);

        const accountData = response.data![0]!;
        expect(accountData).toHaveProperty('balance_total');
        expect(typeof accountData.balance_total).toBe('string');
        expect(accountData.balance_total).toMatch(/^\d+$/);
      }, 30000);
    });

    describe('Raw Address Transactions', () => {
      it('should fetch raw address transactions with augmented currency fields', async () => {
        const transactions = await provider.execute<TaostatsTransactionAugmented[]>({
          address: testAddress,
          type: 'getRawAddressTransactions',
        });

        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          // Verify raw API transaction structure
          expect(firstTx).toHaveProperty('transaction_hash');
          expect(firstTx).toHaveProperty('from');
          expect(firstTx).toHaveProperty('to');
          expect(firstTx).toHaveProperty('amount');
          expect(firstTx).toHaveProperty('block_number');
          expect(firstTx).toHaveProperty('timestamp');
          expect(firstTx).toHaveProperty('extrinsic_id');
          expect(typeof firstTx.transaction_hash).toBe('string');
          expect(typeof firstTx.from).toBe('object');
          expect(firstTx.from).toHaveProperty('ss58');
          expect(firstTx.from).toHaveProperty('hex');
          expect(typeof firstTx.to).toBe('object');
          expect(firstTx.to).toHaveProperty('ss58');
          expect(firstTx.to).toHaveProperty('hex');
          expect(typeof firstTx.timestamp).toBe('string'); // ISO string
          // Verify augmented fields
          expect(firstTx._nativeCurrency).toBe('TAO');
          expect(firstTx._nativeDecimals).toBe(9);
          expect(firstTx._chainDisplayName).toBe('Bittensor Network');
        }
      }, 30000);
    });

    describe('Raw Address Transactions with since parameter', () => {
      it('should fetch transactions after a specific timestamp', async () => {
        // Use a timestamp from 1 year ago to ensure we capture existing transactions
        const sinceTimestamp = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000; // 2 years ago

        const transactions = await provider.execute<TaostatsTransactionAugmented[]>({
          address: testAddress,
          type: 'getRawAddressTransactions',
          since: sinceTimestamp,
        });

        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          // Verify all transactions are after the specified timestamp
          transactions.forEach((tx) => {
            // Taostats returns ISO timestamp string
            const txTimestamp = new Date(tx.timestamp).getTime();
            expect(txTimestamp).toBeGreaterThanOrEqual(sinceTimestamp);
          });
        }
      }, 30000);
    });
  });
});
