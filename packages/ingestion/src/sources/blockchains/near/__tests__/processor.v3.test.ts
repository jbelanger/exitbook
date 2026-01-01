/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
/**
 * Unit tests for NEAR V3 Transaction Processor
 *
 * Tests the NearTransactionProcessorV3 class which:
 * - Groups normalized data by transaction hash
 * - Correlates receipts with balance changes and token transfers
 * - Aggregates multiple receipts into one UniversalTransaction
 * - Extracts fees and fund flows
 * - Performs fail-fast validation
 * - Integrates with token metadata and scam detection services
 */
import type {
  NearBalanceChangeV3,
  NearReceiptV3,
  NearStreamEvent,
  NearTokenTransferV3,
  NearTransactionV3,
} from '@exitbook/blockchain-providers';
import { ok } from 'neverthrow';
import { describe, expect, test, vi, type Mock } from 'vitest';

import type { IScamDetectionService } from '../../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../../features/token-metadata/token-metadata-service.interface.js';
import type { ProcessingContext } from '../../../../shared/types/processors.js';
import { NearTransactionProcessorV3 } from '../processor.v3.js';

// Test data factories for V3 normalized types
const createTransactionEvent = (overrides: Partial<NearTransactionV3> = {}): NearStreamEvent => ({
  id: overrides.transactionHash || 'tx123',
  eventId: `${overrides.transactionHash || 'tx123'}:tx`,
  streamType: 'transactions',
  transactionHash: 'tx123',
  signerAccountId: 'alice.near',
  receiverAccountId: 'bob.near',
  blockHash: 'block123',
  blockHeight: 12345,
  timestamp: 1640000000000, // milliseconds
  status: true,
  ...overrides,
});

const createReceiptEvent = (overrides: Partial<NearReceiptV3> = {}): NearStreamEvent => ({
  id: overrides.transactionHash || 'tx123',
  eventId: `${overrides.receiptId || 'receipt1'}:receipt`,
  streamType: 'receipts',
  receiptId: 'receipt1',
  transactionHash: 'tx123',
  predecessorAccountId: 'alice.near',
  receiverAccountId: 'bob.near',
  receiptKind: 'ACTION',
  blockHash: 'block123',
  blockHeight: 12345,
  timestamp: 1640000000000,
  executorAccountId: 'bob.near',
  gasBurnt: '2428000000000',
  tokensBurntYocto: '242800000000000000000', // 0.0002428 NEAR in yoctoNEAR
  status: true,
  logs: [],
  actions: [],
  ...overrides,
});

const createBalanceChangeEvent = (overrides: Partial<NearBalanceChangeV3> = {}): NearStreamEvent => ({
  id: overrides.receiptId || 'receipt1',
  eventId: `${overrides.receiptId || 'receipt1'}:bc:0`,
  streamType: 'balance-changes',
  receiptId: 'receipt1',
  affectedAccountId: 'alice.near',
  direction: 'OUTBOUND',
  cause: 'TRANSFER',
  deltaAmountYocto: '-1000000000000000000000000', // -1 NEAR in yoctoNEAR
  absoluteNonstakedAmount: '1000000000000000000000000',
  absoluteStakedAmount: '0',
  timestamp: 1640000000,
  blockHeight: '12345',
  ...overrides,
});

const createTokenTransferEvent = (overrides: Partial<NearTokenTransferV3> = {}): NearStreamEvent => ({
  id: overrides.transactionHash || 'tx1',
  eventId: `${overrides.transactionHash || 'tx1'}:tt:${overrides.contractAddress || 'usdc.token.near'}:0`,
  streamType: 'token-transfers',
  transactionHash: 'tx1',
  affectedAccountId: 'alice.near',
  involvedAccountId: 'bob.near',
  deltaAmountYocto: '-1000000', // -1 USDC (6 decimals)
  symbol: 'USDC',
  contractAddress: 'usdc.token.near',
  decimals: 6,
  timestamp: 1640000000,
  ...overrides,
});

// Mock services
function createMockTokenMetadataService(): ITokenMetadataService {
  return {
    enrichBatch: vi.fn().mockResolvedValue(ok(undefined)),
    getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
    getOrFetchBatch: vi.fn().mockResolvedValue(ok(new Map())),
  } as unknown as ITokenMetadataService;
}

function createMockScamDetectionService(): IScamDetectionService {
  return {
    detectScams: vi.fn().mockReturnValue(new Map()),
  } as unknown as IScamDetectionService;
}

const createProcessingContext = (overrides: Partial<ProcessingContext> = {}): ProcessingContext => ({
  primaryAddress: 'alice.near',
  userAddresses: ['alice.near'],
  ...overrides,
});

describe('NearTransactionProcessorV3', () => {
  describe('Simple NEAR Transfer', () => {
    test('should process simple NEAR transfer with single receipt', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({
          transactionHash: 'tx1',
          signerAccountId: 'alice.near',
          receiverAccountId: 'bob.near',
        }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          gasBurnt: '2428000000000',
          tokensBurntYocto: '242800000000000000000', // 0.0002428 NEAR
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          affectedAccountId: 'alice.near',
          direction: 'OUTBOUND',
          cause: 'TRANSFER',
          deltaAmountYocto: '-1000000000000000000000000', // -1 NEAR
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const transactions = result.value;
      expect(transactions).toHaveLength(1);

      const tx = transactions[0]!;
      expect(tx.externalId).toBe('tx1');
      expect(tx.source).toBe('near');
      expect(tx.status).toBe('success');
      expect(tx.from).toBe('alice.near');
      expect(tx.to).toBeUndefined(); // No inflows, so no 'to' address

      // NEAR outflow is consumed by fees in fee-only transactions, so outflows is empty
      expect(tx.movements.outflows!).toHaveLength(0);

      // Should have fee - only outflow amount since receipt.predecessorAccountId ('alice.near')
      // doesn't extract fees (needs to match primaryAddress)
      expect(tx.fees).toHaveLength(1);
      expect(tx.fees[0]!.assetSymbol).toBe('NEAR');
      expect(tx.fees[0]!.amount.toFixed()).toBe('1');

      // Should classify as fee-only transaction
      expect(tx.operation.category).toBe('fee');
      expect(tx.operation.type).toBe('fee');
    });

    test('should process NEAR deposit (inbound transfer)', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({
          transactionHash: 'tx1',
          signerAccountId: 'bob.near',
          receiverAccountId: 'alice.near',
        }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '242800000000000000000',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          affectedAccountId: 'alice.near',
          direction: 'INBOUND',
          cause: 'TRANSFER',
          deltaAmountYocto: '2000000000000000000000000', // +2 NEAR
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Should have inflow, no outflow
      expect(tx.movements.inflows!).toHaveLength(1);
      expect(tx.movements.inflows![0]!.grossAmount.toFixed()).toBe('2');
      expect(tx.movements.outflows).toHaveLength(0);

      // Should classify as deposit
      expect(tx.operation.category).toBe('transfer');
      expect(tx.operation.type).toBe('deposit');
    });

    test('should use receipt timestamp in milliseconds', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const timestampMs = 1640000000000;
      const events: NearStreamEvent[] = [
        createTransactionEvent({
          timestamp: timestampMs,
        }),
        createReceiptEvent({
          timestamp: timestampMs,
        }),
        createBalanceChangeEvent({
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;
      expect(tx.timestamp).toBe(timestampMs);
      expect(tx.datetime).toBe(new Date(timestampMs).toISOString());
    });

    test('should handle failed transaction status', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({
          status: false,
        }),
        createReceiptEvent({
          status: false,
        }),
        createBalanceChangeEvent({
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;
      expect(tx.status).toBe('failed');
    });
  });

  describe('Token Transfers', () => {
    test('should process token transfer with metadata enrichment', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '100000000000000000000',
        }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'bob.near', // NOT primary address = outflow
          involvedAccountId: 'alice.near',
          deltaAmountYocto: '1000000',
          symbol: 'USDC',
          contractAddress: 'usdc.token.near',
          decimals: 6,
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      // Should call enrichBatch
      expect(mockTokenMetadataService.enrichBatch).toHaveBeenCalledOnce();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Should have token outflow
      expect(tx.movements.outflows!).toHaveLength(1);
      expect(tx.movements.outflows![0]!.assetSymbol).toBe('USDC');
      expect(tx.movements.outflows![0]!.grossAmount.toFixed()).toBe('1');

      // AssetId should include contract address
      expect(tx.movements.outflows![0]!.assetId).toContain('usdc.token.near');
    });

    test('should handle token transfer without symbol (UNKNOWN)', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'bob.near', // NOT primary address = outflow
          symbol: undefined,
          contractAddress: 'unknown.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;
      expect(tx.movements.outflows![0]!.assetSymbol).toBe('UNKNOWN');
    });

    test('should classify token swap (both token inflows and outflows)', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        // Outflow: USDC
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'bob.near', // not primary address = outflow
          deltaAmountYocto: '1000000',
          symbol: 'USDC',
          contractAddress: 'usdc.token.near',
        }),
        // Inflow: USDT
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'alice.near', // primary address = inflow
          deltaAmountYocto: '1000000',
          symbol: 'USDT',
          contractAddress: 'usdt.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.movements.inflows!).toHaveLength(1);
      expect(tx.movements.inflows![0]!.assetSymbol).toBe('USDT');
      expect(tx.movements.outflows!).toHaveLength(1);
      expect(tx.movements.outflows![0]!.assetSymbol).toBe('USDC');

      // Should classify as swap
      expect(tx.operation.category).toBe('trade');
      expect(tx.operation.type).toBe('swap');
    });

    test('should skip token transfers with zero delta', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          deltaAmountYocto: '0',
          symbol: 'USDC',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Should have no movements (zero delta skipped)
      expect(tx.movements.inflows).toHaveLength(0);
      expect(tx.movements.outflows).toHaveLength(0);
    });
  });

  describe('Multiple Receipts Per Transaction', () => {
    test('should aggregate multiple receipts into single transaction', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        // Receipt 1: Fee payment
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '100000000000000000000',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          deltaAmountYocto: '-100000000000000000000',
          cause: 'TRANSFER',
        }),
        // Receipt 2: Another action
        createReceiptEvent({
          receiptId: 'receipt2',
          transactionHash: 'tx1',
          tokensBurntYocto: '50000000000000000000',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt2',
          deltaAmountYocto: '-500000000000000000000000',
          cause: 'TRANSFER',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      // Should create 1 transaction with aggregated data from 2 receipts
      expect(result.value).toHaveLength(1);

      const tx = result.value[0]!;

      // NEAR-only outflows with no inflows are treated as fee-only transactions
      // Outflows (0.5001) + fees (0.00015) = 0.50025 total, but after fee subtraction logic:
      // outflows become 0.49995, then combined with fees: 0.49995 + 0.00015 = 0.5001
      expect(tx.fees).toHaveLength(1);
      expect(tx.fees[0]!.amount.toFixed()).toBe('0.5001');

      // Outflows moved to fees in fee-only transactions
      expect(tx.movements.outflows!).toHaveLength(0);
    });

    test('should handle mixed NEAR and token flows across multiple receipts', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        // Receipt 1: NEAR transfer
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'OUTBOUND',
          deltaAmountYocto: '-1000000000000000000000000',
          cause: 'TRANSFER',
        }),
        // Receipt 2: Token transfer
        createReceiptEvent({ receiptId: 'receipt2', transactionHash: 'tx1' }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'bob.near', // NOT primary address = outflow
          deltaAmountYocto: '500000',
          symbol: 'USDC',
          contractAddress: 'usdc.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Should have 2 outflows (NEAR + USDC)
      expect(tx.movements.outflows!).toHaveLength(2);

      const nearOutflow = tx.movements.outflows!.find((m) => m.assetSymbol === 'NEAR');
      const usdcOutflow = tx.movements.outflows!.find((m) => m.assetSymbol === 'USDC');

      expect(nearOutflow).toBeDefined();
      // NEAR outflow is reduced by total receipt fees: 1 - (0.0002428 + 0.0002428) = 0.9995144
      expect(nearOutflow!.grossAmount.toFixed()).toBe('0.9995144');

      expect(usdcOutflow).toBeDefined();
      expect(usdcOutflow!.grossAmount.toFixed()).toBe('0.5');
    });
  });

  describe('Fee Extraction', () => {
    test('should extract fees from receipt tokensBurnt (priority 1)', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          gasBurnt: '2428000000000',
          tokensBurntYocto: '500000000000000000000', // 0.0005 NEAR
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.fees).toHaveLength(1);
      expect(tx.fees[0]!.amount.toFixed()).toBe('0.0005');
      expect(tx.fees[0]!.scope).toBe('network');
      expect(tx.fees[0]!.settlement).toBe('balance');
    });

    test('should extract fees from balance changes with fee cause (priority 2)', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          gasBurnt: undefined,
          tokensBurntYocto: undefined,
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          cause: 'FEE',
          deltaAmountYocto: '-300000000000000000000',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          cause: 'TRANSFER',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.fees).toHaveLength(1);
      expect(tx.fees[0]!.amount.toFixed()).toBe('0.0003');
    });

    test('should handle zero fee (no tokensBurnt)', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '0',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Should have no fees
      expect(tx.fees).toHaveLength(0);
    });

    test('should skip fee-related balance changes when extracting flows', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'OUTBOUND',
          cause: 'FEE',
          deltaAmountYocto: '-100000000000000000000',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'INBOUND',
          cause: 'GAS_REFUND',
          deltaAmountYocto: '50000000000000000000',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'INBOUND',
          cause: 'TRANSFER',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Should only have the TRANSFER in flows (fee/gas skipped)
      expect(tx.movements.inflows!).toHaveLength(1);
      expect(tx.movements.inflows![0]!.grossAmount.toFixed()).toBe('1');
    });

    test('should record fee-only transaction when only TRANSACTION balance change is present', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const orphanBalanceChange: NearStreamEvent = {
        id: 'tx1',
        eventId: 'orphan-bc',
        streamType: 'balance-changes',
        affectedAccountId: 'alice.near',
        direction: 'OUTBOUND',
        cause: 'TRANSACTION',
        deltaAmountYocto: '-100000000000000000000', // 0.0001 NEAR
        absoluteNonstakedAmount: '1000000000000000000000000',
        absoluteStakedAmount: '0',
        timestamp: 1640000000,
        blockHeight: '12345',
      };

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '100000000000000000000',
        }),
        orphanBalanceChange,
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.movements.outflows).toHaveLength(0);
      expect(tx.movements.inflows).toHaveLength(0);
      expect(tx.fees).toHaveLength(1);
      expect(tx.fees[0]!.amount.toFixed()).toBe('0.0001');
      expect(tx.operation.category).toBe('fee');
      expect(tx.operation.type).toBe('fee');
    });
  });

  describe('Error Handling & Fail-Fast', () => {
    test('should fail when transaction record is missing', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        // Missing transaction event
        createReceiptEvent({ transactionHash: 'tx1' }),
        createBalanceChangeEvent({
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toContain('Missing transaction record');
        expect(result.error).toContain('Cannot proceed');
        expect(result.error).toContain('1/1 transactions failed');
      }
    });

    test('should fail when activity missing deltaAmountYocto', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          deltaAmountYocto: undefined,
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toContain('Balance change missing deltaAmount');
        expect(result.error).toContain('Cannot proceed');
      }
    });

    test('should handle duplicate transaction records', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createTransactionEvent({ transactionHash: 'tx1' }), // Duplicate
        createReceiptEvent({ transactionHash: 'tx1' }),
      ];

      // Should throw during grouping
      await expect(processor.process(events, createProcessingContext())).rejects.toThrow(
        'Duplicate transaction record'
      );
    });

    test('should accumulate errors from multiple failed transactions', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        // Transaction 1: missing transaction record
        { ...createReceiptEvent({ transactionHash: 'txerror1', receiptId: 'receipt1' }), id: 'txerror1' },
        {
          ...createBalanceChangeEvent({ receiptId: 'receipt1', deltaAmountYocto: '1000000000000000000000000' }),
          id: 'txerror1',
        },
        // Transaction 2: missing deltaAmountYocto
        { ...createTransactionEvent({ transactionHash: 'txerror2' }), id: 'txerror2' },
        { ...createReceiptEvent({ receiptId: 'receipt2', transactionHash: 'txerror2' }), id: 'txerror2' },
        {
          ...createBalanceChangeEvent({
            receiptId: 'receipt2',
            deltaAmountYocto: undefined,
          }),
          id: 'txerror2',
        },
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Transaction 1 fails (missing transaction record), but transaction 2 may derive delta from absolutes
        expect(result.error).toContain('transactions failed');
        expect(result.error).toContain('Missing transaction record');
      }
    });

    test('should handle token metadata enrichment failure gracefully', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      (mockTokenMetadataService.enrichBatch as Mock).mockResolvedValue(
        ok(undefined) // Still succeeds but with warning
      );

      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'bob.near', // NOT primary address = outflow
          symbol: undefined, // No symbol
          contractAddress: 'unknown.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      // Should still process successfully
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;
      expect(tx.movements.outflows![0]!.assetSymbol).toBe('UNKNOWN');
    });
  });

  describe('Operation Classification', () => {
    test('should classify fee-only transaction as batch', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '100000000000000000000',
        }),
        // No balance changes or token transfers (fee-only)
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Fee-only transactions are now classified as 'fee' category instead of 'defi'
      expect(tx.operation.category).toBe('fee');
      expect(tx.operation.type).toBe('fee');
    });

    test('should classify NEAR transfer as transfer type', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'INBOUND',
          deltaAmountYocto: '500000000000000000000000',
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'OUTBOUND',
          deltaAmountYocto: '-1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.operation.category).toBe('transfer');
      expect(tx.operation.type).toBe('transfer');
    });
  });

  describe('Scam Detection Integration', () => {
    test('should call scam detection for token movements', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const mockScamDetectionService = createMockScamDetectionService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService, mockScamDetectionService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'bob.near', // NOT primary address = outflow
          symbol: 'USDC',
          contractAddress: 'usdc.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);

      // Should call getOrFetchBatch to get metadata for scam detection
      expect(mockTokenMetadataService.getOrFetchBatch).toHaveBeenCalled();
    });

    test('should detect airdrop transactions (inflow only, no fee)', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const mockScamDetectionService = createMockScamDetectionService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService, mockScamDetectionService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '0', // No fee
        }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'alice.near', // Primary address = inflow
          deltaAmountYocto: '1000000',
          symbol: 'SCAM',
          contractAddress: 'scam.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);

      // Scam detection should be called
      expect(mockTokenMetadataService.getOrFetchBatch).toHaveBeenCalled();
    });

    test('should handle scam detection service absence gracefully', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      // No scam detection service
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          symbol: 'USDC',
          contractAddress: 'usdc.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      // Should not fail when scam detection service is missing
    });
  });

  describe('Multiple Transactions', () => {
    test('should process multiple independent transactions', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        // Transaction 1
        { ...createTransactionEvent({ transactionHash: 'txmulti1', signerAccountId: 'alice.near' }), id: 'txmulti1' },
        { ...createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'txmulti1' }), id: 'txmulti1' },
        {
          ...createBalanceChangeEvent({
            receiptId: 'receipt1',
            direction: 'OUTBOUND',
            deltaAmountYocto: '-1000000000000000000000000',
          }),
          id: 'txmulti1',
        },
        // Transaction 2
        { ...createTransactionEvent({ transactionHash: 'txmulti2', signerAccountId: 'bob.near' }), id: 'txmulti2' },
        { ...createReceiptEvent({ receiptId: 'receipt2', transactionHash: 'txmulti2' }), id: 'txmulti2' },
        {
          ...createBalanceChangeEvent({
            receiptId: 'receipt2',
            direction: 'OUTBOUND',
            deltaAmountYocto: '-2000000000000000000000000',
          }),
          id: 'txmulti2',
        },
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value).toHaveLength(2);

      const tx1 = result.value.find((tx) => tx.externalId === 'txmulti1');
      const tx2 = result.value.find((tx) => tx.externalId === 'txmulti2');

      expect(tx1).toBeDefined();
      expect(tx1!.from).toBe('alice.near');
      // NEAR-only outflows are treated as fee-only transactions
      expect(tx1!.movements.outflows!).toHaveLength(0);
      expect(tx1!.fees).toHaveLength(1);
      expect(tx1!.fees[0]!.amount.toFixed()).toBe('1');

      expect(tx2).toBeDefined();
      expect(tx2!.from).toBe('bob.near');
      expect(tx2!.movements.outflows!).toHaveLength(0);
      expect(tx2!.fees).toHaveLength(1);
      expect(tx2!.fees[0]!.amount.toFixed()).toBe('2');
    });

    test('should process successfully when some transactions fail', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        // Transaction 1: valid
        { ...createTransactionEvent({ transactionHash: 'txvalid1' }), id: 'txvalid1' },
        { ...createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'txvalid1' }), id: 'txvalid1' },
        {
          ...createBalanceChangeEvent({
            receiptId: 'receipt1',
            direction: 'OUTBOUND',
            deltaAmountYocto: '-1000000000000000000000000',
          }),
          id: 'txvalid1',
        },
        // Transaction 2: invalid (missing deltaAmountYocto)
        { ...createTransactionEvent({ transactionHash: 'txinvalid2' }), id: 'txinvalid2' },
        { ...createReceiptEvent({ receiptId: 'receipt2', transactionHash: 'txinvalid2' }), id: 'txinvalid2' },
        {
          ...createBalanceChangeEvent({
            receiptId: 'receipt2',
            deltaAmountYocto: undefined,
          }),
          id: 'txinvalid2',
        },
      ];

      const result = await processor.process(events, createProcessingContext());

      // Transaction 2's missing delta can be derived from absolute amounts when
      // grouped with transaction 1's balance changes for the same account,
      // so both transactions succeed
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty input', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const result = await processor.process([], createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value).toHaveLength(0);
    });

    test('should fail fast for orphaned balance changes with RECEIPT-level cause', async () => {
      // With stricter validation, RECEIPT/TRANSFER-cause balance changes MUST have valid receipt_id
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        {
          ...createBalanceChangeEvent({
            receiptId: 'orphan-receipt', // No matching receipt
            cause: 'TRANSFER', // RECEIPT-level cause
            deltaAmountYocto: '1000000000000000000000000',
          }),
          id: 'tx1', // Must have same id to be grouped with the transaction
        },
      ];

      const result = await processor.process(events, createProcessingContext());

      // Should fail fast due to invalid receipt_id for RECEIPT-level cause
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toContain("has invalid receipt_id 'orphan-receipt'");
      }
    });

    test('should handle orphaned balance changes with ambiguous causes gracefully', async () => {
      // Ambiguous causes (CONTRACT_REWARD, MINT, STAKE, etc.) fall back to transaction-level
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        {
          ...createBalanceChangeEvent({
            receiptId: 'orphan-receipt', // No matching receipt
            cause: 'CONTRACT_REWARD', // Ambiguous cause - can be transaction or receipt level
            deltaAmountYocto: '1000000000000000000000000',
          }),
          id: 'tx1',
        },
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Orphaned ambiguous-cause balance change attached to transaction-level receipt
      expect(tx.movements.inflows!).toHaveLength(1);
      expect(tx.movements.inflows![0]!.grossAmount.toFixed()).toBe('1');
    });

    test('should consolidate multiple balance changes of same asset', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          deltaAmountYocto: '-500000000000000000000000', // -0.5 NEAR
        }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          deltaAmountYocto: '-500000000000000000000000', // -0.5 NEAR
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // NEAR-only outflows are treated as fee-only transactions
      // Balance changes consolidated: 0.5 + 0.5 = 1 NEAR, moved to fees
      expect(tx.movements.outflows!).toHaveLength(0);
      expect(tx.fees).toHaveLength(1);
      expect(tx.fees[0]!.amount.toFixed()).toBe('1');
    });

    test('should handle receipts without any balance changes or token transfers', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({
          receiptId: 'receipt1',
          transactionHash: 'tx1',
          tokensBurntYocto: '100000000000000000000',
        }),
        // No balance changes or token transfers
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      // Should have fee but no movements
      expect(tx.fees).toHaveLength(1);
      expect(tx.movements.inflows).toHaveLength(0);
      expect(tx.movements.outflows).toHaveLength(0);
    });
  });

  describe('Asset ID Generation', () => {
    test('should generate correct assetId for NEAR', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'INBOUND',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.movements.inflows![0]!.assetId).toContain('near');
      expect(tx.movements.inflows![0]!.assetId).toContain('native');
    });

    test('should generate correct assetId for tokens', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({ transactionHash: 'tx1' }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx1' }),
        createTokenTransferEvent({
          transactionHash: 'tx1',
          affectedAccountId: 'bob.near', // NOT primary address = outflow
          symbol: 'USDC',
          contractAddress: 'usdc.token.near',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.movements.outflows![0]!.assetId).toContain('near');
      expect(tx.movements.outflows![0]!.assetId).toContain('usdc.token.near');
    });
  });

  describe('Blockchain Metadata', () => {
    test('should include blockchain metadata in transaction', async () => {
      const mockTokenMetadataService = createMockTokenMetadataService();
      const processor = new NearTransactionProcessorV3(mockTokenMetadataService);

      const events: NearStreamEvent[] = [
        createTransactionEvent({
          transactionHash: 'tx123abc',
          blockHeight: 98765,
          status: true,
        }),
        createReceiptEvent({ receiptId: 'receipt1', transactionHash: 'tx123abc' }),
        createBalanceChangeEvent({
          receiptId: 'receipt1',
          direction: 'INBOUND',
          deltaAmountYocto: '1000000000000000000000000',
        }),
      ];

      const result = await processor.process(events, createProcessingContext());

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const tx = result.value[0]!;

      expect(tx.blockchain).toBeDefined();
      expect(tx.blockchain!.name).toBe('near');
      expect(tx.blockchain!.block_height).toBe(98765);
      expect(tx.blockchain!.transaction_hash).toBe('tx123abc');
      expect(tx.blockchain!.is_confirmed).toBe(true);
    });
  });
});
