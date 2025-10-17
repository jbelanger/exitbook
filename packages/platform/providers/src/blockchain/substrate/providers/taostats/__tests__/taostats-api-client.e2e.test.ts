import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../core/blockchain/types/index.ts';
import type { SubstrateTransaction } from '../../../types.ts';
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
        const result = await provider.execute<TaostatsBalanceResponse>({
          address: testAddress,
          type: 'getAddressBalances',
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          throw result.error;
        }

        const response = result.value;
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
      it('should fetch raw address transactions with normalization', async () => {
        const result = await provider.execute<TransactionWithRawData<SubstrateTransaction>[]>({
          address: testAddress,
          type: 'getAddressTransactions',
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          throw result.error;
        }

        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;

          expect(firstTx).toHaveProperty('raw');
          expect(firstTx).toHaveProperty('normalized');

          const rawData = firstTx.raw as TaostatsTransactionAugmented;

          expect(rawData).toHaveProperty('transaction_hash');
          expect(rawData).toHaveProperty('from');
          expect(rawData).toHaveProperty('to');
          expect(rawData).toHaveProperty('amount');
          expect(rawData).toHaveProperty('block_number');
          expect(rawData).toHaveProperty('timestamp');
          expect(rawData).toHaveProperty('extrinsic_id');
          expect(typeof rawData.transaction_hash).toBe('string');
          expect(typeof rawData.from).toBe('object');
          expect(rawData.from).toHaveProperty('ss58');
          expect(rawData.from).toHaveProperty('hex');
          expect(typeof rawData.to).toBe('object');
          expect(rawData.to).toHaveProperty('ss58');
          expect(rawData.to).toHaveProperty('hex');
          expect(typeof rawData.timestamp).toBe('string'); // ISO string

          expect(rawData._nativeCurrency).toBe('TAO');
          expect(rawData._nativeDecimals).toBe(9);
          expect(rawData._chainDisplayName).toBe('Bittensor Network');

          const normalized = firstTx.normalized;
          expect(normalized).toHaveProperty('id');
          expect(normalized).toHaveProperty('from');
          expect(normalized).toHaveProperty('to');
          expect(normalized).toHaveProperty('amount');
          expect(normalized).toHaveProperty('currency');
          expect(normalized).toHaveProperty('timestamp');
          expect(normalized).toHaveProperty('status');
          expect(normalized).toHaveProperty('providerId');
          expect(normalized).toHaveProperty('feeAmount');
          expect(normalized).toHaveProperty('feeCurrency');

          expect(normalized.currency).toBe('TAO');
          expect(normalized.feeCurrency).toBe('TAO');
          expect(normalized.providerId).toBe('taostats');
          expect(normalized.chainName).toBe('bittensor');
          expect(normalized.status).toBe('success');
          expect(typeof normalized.amount).toBe('string');
          expect(typeof normalized.timestamp).toBe('number');
        }
      }, 30000);
    });

    describe('Raw Address Transactions with since parameter', () => {
      it('should fetch transactions after a specific timestamp', async () => {
        // Use a timestamp from 1 year ago to ensure we capture existing transactions
        const sinceTimestamp = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000; // 2 years ago

        const result = await provider.execute<TransactionWithRawData<SubstrateTransaction>[]>({
          address: testAddress,
          type: 'getAddressTransactions',
          since: sinceTimestamp,
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          throw result.error;
        }

        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          transactions.forEach((tx) => {
            // Verify using normalized timestamp (already converted to number)
            expect(tx.normalized.timestamp).toBeGreaterThanOrEqual(sinceTimestamp);
          });
        }
      }, 30000);
    });
  });
});
