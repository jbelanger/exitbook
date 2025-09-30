import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { SnowtraceApiClient } from '../snowtrace.api-client.js';
import { SnowtraceTransactionMapper } from '../snowtrace.mapper.js';
import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from '../snowtrace.types.js';

describe('SnowtraceTransactionMapper E2E', () => {
  const mapper = new SnowtraceTransactionMapper();
  const apiClient = new SnowtraceApiClient();
  // AVAX address with ~964 transactions for testing
  const testAddress = '0x70c68a08d8c1C1Fa1CD5E5533e85a77c4Ac07022';

  let cachedNormalTransactions: SnowtraceTransaction[];
  let cachedInternalTransactions: SnowtraceInternalTransaction[];
  let cachedTokenTransfers: SnowtraceTokenTransfer[];

  beforeAll(async () => {
    // Fetch normal and internal transactions
    const transactions = await apiClient.execute<{
      internal: SnowtraceInternalTransaction[];
      normal: SnowtraceTransaction[];
    }>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    cachedNormalTransactions = transactions.normal;
    cachedInternalTransactions = transactions.internal;

    // Fetch token transfers
    cachedTokenTransfers = await apiClient.execute<SnowtraceTokenTransfer[]>({
      address: testAddress,
      type: 'getTokenTransactions',
    });
  }, 120000);

  describe('Normal Transactions', () => {
    it('should map normal transaction data from API', () => {
      if (cachedNormalTransactions.length === 0) {
        console.warn('No normal transactions found, skipping test');
        return;
      }

      const rawTx = cachedNormalTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.currency).toBe('AVAX');
        expect(normalized.providerId).toBe('snowtrace');
        expect(normalized.status).toMatch(/success|failed/);
        expect(normalized.from).toBe(rawTx.from);
        expect(normalized.to).toBe(rawTx.to);
        expect(normalized.amount).toBe(rawTx.value);
        expect(normalized.timestamp).toBeGreaterThan(0);
        expect(normalized.blockHeight).toBe(parseInt(rawTx.blockNumber));
      }
    });

    it('should handle successful transactions correctly', () => {
      const successTx = cachedNormalTransactions.find((tx) => tx.txreceipt_status === '1');
      if (!successTx) {
        console.warn('No successful transactions found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(successTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.status).toBe('success');
        expect(normalized.blockHeight).toBeDefined();
        expect(normalized.blockId).toBeDefined();
      }
    });

    it('should map transaction fees correctly', () => {
      const txWithFee = cachedNormalTransactions.find((tx) => tx.gasUsed && tx.gasPrice);
      if (!txWithFee) {
        console.warn('No transactions with fees found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(txWithFee, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeAmount).toBeDefined();
        expect(normalized.feeCurrency).toBe('AVAX');
        expect(BigInt(normalized.feeAmount!)).toBeGreaterThan(0n);
        expect(normalized.gasUsed).toBe(txWithFee.gasUsed);
        expect(normalized.gasPrice).toBe(txWithFee.gasPrice);
      }
    });

    it('should identify contract calls with function names', () => {
      const contractCallTx = cachedNormalTransactions.find((tx) => tx.functionName);
      if (!contractCallTx) {
        console.warn('No contract call transactions found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(contractCallTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.type).toBe('contract_call');
        expect(normalized.functionName).toBe(contractCallTx.functionName);
        expect(normalized.methodId).toBeDefined();
        expect(normalized.inputData).toBeDefined();
      }
    });
  });

  describe('Internal Transactions', () => {
    it('should map internal transaction data from API', () => {
      if (cachedInternalTransactions.length === 0) {
        console.warn('No internal transactions found, skipping test');
        return;
      }

      const rawTx = cachedInternalTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.currency).toBe('AVAX');
        expect(normalized.providerId).toBe('snowtrace');
        expect(normalized.type).toBe('internal');
        expect(normalized.traceId).toBe(rawTx.traceId);
        expect(normalized.from).toBe(rawTx.from);
        expect(normalized.to).toBe(rawTx.to);
        expect(normalized.amount).toBe(rawTx.value);
        expect(normalized.timestamp).toBeGreaterThan(0);
        expect(normalized.blockHeight).toBe(parseInt(rawTx.blockNumber));
      }
    });

    it('should handle internal transaction errors', () => {
      const errorTx = cachedInternalTransactions.find((tx) => tx.isError === '1');
      if (!errorTx) {
        console.warn('No errored internal transactions found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(errorTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.status).toBe('failed');
      }
    });
  });

  describe('Token Transfers', () => {
    it('should map token transfer data from API', () => {
      if (cachedTokenTransfers.length === 0) {
        console.warn('No token transfers found, skipping test');
        return;
      }

      const rawTx = cachedTokenTransfers[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.currency).toBe(rawTx.tokenSymbol);
        expect(normalized.providerId).toBe('snowtrace');
        expect(normalized.type).toBe('token_transfer');
        expect(normalized.tokenSymbol).toBe(rawTx.tokenSymbol);
        expect(normalized.tokenAddress).toBe(rawTx.contractAddress);
        expect(normalized.tokenDecimals).toBe(parseInt(rawTx.tokenDecimal));
        expect(normalized.tokenType).toBe('erc20');
        expect(normalized.from).toBe(rawTx.from);
        expect(normalized.to).toBe(rawTx.to);
        expect(normalized.amount).toBe(rawTx.value);
        expect(normalized.timestamp).toBeGreaterThan(0);
      }
    });

    it('should map token transfer fees in native currency', () => {
      if (cachedTokenTransfers.length === 0) {
        console.warn('No token transfers found, skipping test');
        return;
      }

      const rawTx = cachedTokenTransfers[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'snowtrace',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // Token fees are paid in AVAX, not the token
        expect(normalized.feeCurrency).toBe('AVAX');
        if (normalized.feeAmount) {
          expect(BigInt(normalized.feeAmount)).toBeGreaterThan(0n);
        }
      }
    });
  });
});
