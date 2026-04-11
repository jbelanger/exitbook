import type { Transaction, TransactionDraft, TransactionLink } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, it, expect } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import {
  buildExportParamsFromFlags,
  convertToCSV,
  convertToNormalizedCSV,
  convertToJSON,
  parseSinceDate,
  type ExportCommandOptions,
} from '../transactions-export-utils.js';

const createTransaction = (
  overrides: Partial<Omit<Transaction, 'movements' | 'fees'>> & {
    fees?: TransactionDraft['fees'] | undefined;
    movements?: TransactionDraft['movements'] | undefined;
  } = {}
): Transaction => {
  const {
    id,
    accountId,
    txFingerprint,
    platformKey,
    platformKind,
    datetime,
    timestamp,
    status,
    movements,
    fees,
    operation,
    ...rest
  } = overrides;

  return createPersistedTransaction({
    ...rest,
    id: id ?? 1,
    accountId: accountId ?? 1,
    txFingerprint: txFingerprint ?? 'ext-1',
    platformKey: platformKey ?? 'kraken',
    platformKind: platformKind ?? 'exchange',
    datetime: datetime ?? '2024-01-01T12:00:00Z',
    timestamp: timestamp ?? Date.parse('2024-01-01T12:00:00Z'),
    status: status ?? 'success',
    movements: movements ?? {
      inflows: [],
      outflows: [],
    },
    fees: fees ?? [],
    operation: operation ?? {
      category: 'trade',
      type: 'buy',
    },
  });
};

describe('export-utils', () => {
  describe('parseSinceDate', () => {
    it('should parse "0" as 0 timestamp', () => {
      const result = parseSinceDate('0');
      expect(assertOk(result)).toBe(0);
    });

    it('should parse ISO date string', () => {
      const result = parseSinceDate('2024-01-01');
      expect(assertOk(result)).toBe(Date.parse('2024-01-01'));
    });

    it('should parse ISO datetime string', () => {
      const result = parseSinceDate('2024-01-01T00:00:00Z');
      expect(assertOk(result)).toBe(Date.parse('2024-01-01T00:00:00Z'));
    });

    it('should reject invalid date format', () => {
      const result = parseSinceDate('not-a-date');
      expect(assertErr(result).message).toContain('Invalid date format');
    });

    it('should reject empty string', () => {
      const result = parseSinceDate('');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('buildExportParamsFromFlags', () => {
    it('should build params with default values', () => {
      const options: ExportCommandOptions = {};
      const result = buildExportParamsFromFlags(options);

      const params = assertOk(result);
      expect(params.format).toBe('csv');
      expect(params.csvFormat).toBe('normalized');
      expect(params.outputPath).toBe('data/transactions.csv');
      expect(params.platformKey).toBeUndefined();
      expect(params.since).toBeUndefined();
    });

    it('should build params with exchange platform', () => {
      const options: ExportCommandOptions = {
        exchange: 'kraken',
        format: 'json',
        output: './exports/kraken.json',
      };
      const result = buildExportParamsFromFlags(options);

      const params = assertOk(result);
      expect(params.platformKey).toBe('kraken');
      expect(params.format).toBe('json');
      expect(params.csvFormat).toBeUndefined();
      expect(params.outputPath).toBe('./exports/kraken.json');
    });

    it('should build params with blockchain platform', () => {
      const options: ExportCommandOptions = {
        blockchain: 'bitcoin',
        format: 'csv',
        output: './exports/bitcoin.csv',
      };
      const result = buildExportParamsFromFlags(options);

      const params = assertOk(result);
      expect(params.platformKey).toBe('bitcoin');
      expect(params.format).toBe('csv');
      expect(params.csvFormat).toBe('normalized');
    });

    it('should build params with since date', () => {
      const options: ExportCommandOptions = {
        since: '2024-01-01',
      };
      const result = buildExportParamsFromFlags(options);

      const params = assertOk(result);
      expect(params.since).toBe(Date.parse('2024-01-01'));
    });

    it('should build params with since set to 0', () => {
      const options: ExportCommandOptions = {
        since: '0',
      };
      const result = buildExportParamsFromFlags(options);

      const params = assertOk(result);
      expect(params.since).toBe(0);
    });

    it('should build params with csv format override', () => {
      const options: ExportCommandOptions = {
        format: 'csv',
        csvFormat: 'simple',
      };
      const result = buildExportParamsFromFlags(options);

      const params = assertOk(result);
      expect(params.format).toBe('csv');
      expect(params.csvFormat).toBe('simple');
    });

    it('should reject csv format when exporting json', () => {
      const options: ExportCommandOptions = {
        format: 'json',
        csvFormat: 'simple',
      };
      const result = buildExportParamsFromFlags(options);

      expect(assertErr(result).message).toContain('--csv-format');
    });

    it('should reject invalid since date', () => {
      const options: ExportCommandOptions = {
        since: 'invalid-date',
      };
      const result = buildExportParamsFromFlags(options);

      expect(assertErr(result).message).toContain('Invalid date format');
    });
  });

  describe('convertToCSV', () => {
    it('should return empty string for empty transactions array', () => {
      const result = convertToCSV([]);
      expect(result).toBe('');
    });

    it('should convert single transaction to CSV', () => {
      const transaction = createTransaction({
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        diagnostics: [
          {
            code: 'classification_uncertain',
            message: 'Needs review',
            severity: 'warning',
          },
        ],
        userNotes: [
          {
            message: 'User note',
            createdAt: '2026-03-15T12:00:00.000Z',
            author: 'user',
          },
        ],
      });

      const result = convertToCSV([transaction]);

      expect(result).toContain('id,tx_fingerprint,platform_key,operation_category');
      expect(result).toContain('1,ext-1,kraken,trade,buy');
      expect(result).toContain('BTC,1.5');
      expect(result).toContain('classification_uncertain');
      expect(result).toContain('Needs review');
      expect(result).toContain('User note');
    });

    it('should convert multiple transactions to CSV', () => {
      const transactions: Transaction[] = [
        createTransaction({
          movements: {
            inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
            outflows: [],
          },
        }),
        createTransaction({
          id: 2,
          txFingerprint: 'ext-2',
          datetime: '2024-01-02T12:00:00Z',
          timestamp: Date.parse('2024-01-02T12:00:00Z'),
          movements: {
            inflows: [],
            outflows: [{ assetId: 'test:eth', assetSymbol: 'ETH' as Currency, grossAmount: parseDecimal('10.0') }],
          },
          operation: {
            category: 'trade',
            type: 'sell',
          },
        }),
      ];

      const result = convertToCSV(transactions);
      const lines = result.split('\n');

      expect(lines).toHaveLength(3); // header + 2 rows
      expect(lines[0]).toContain('id,tx_fingerprint,platform_key,operation_category');
      expect(lines[1]).toContain('1,ext-1,kraken,trade,buy');
      expect(lines[2]).toContain('2,ext-2,kraken,trade,sell');
    });

    it('should escape values with commas', () => {
      const transaction = createTransaction({
        platformKey: 'test,source',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
      });

      const result = convertToCSV([transaction]);

      expect(result).toContain('"test,source"');
    });

    it('should include both inflow and outflow movements for swaps', () => {
      const transaction = createTransaction({
        id: 1822,
        txFingerprint: 'ext-1822',
        datetime: '2024-01-03T12:00:00Z',
        timestamp: Date.parse('2024-01-03T12:00:00Z'),
        movements: {
          inflows: [{ assetId: 'test:stx', assetSymbol: 'STX' as Currency, grossAmount: parseDecimal('59.289') }],
          outflows: [{ assetId: 'test:cad', assetSymbol: 'CAD' as Currency, grossAmount: parseDecimal('98.52') }],
        },
        operation: {
          category: 'trade',
          type: 'swap',
        },
      });

      const result = convertToCSV([transaction]);
      const [headerLine, dataLine] = result.split('\n');
      const headers = headerLine?.split(',') ?? [];
      const values = dataLine?.split(',') ?? [];
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));

      expect(record['inflow_assets']).toBe('STX');
      expect(record['inflow_amounts']).toBe('59.289');
      expect(record['outflow_assets']).toBe('CAD');
      expect(record['outflow_amounts']).toBe('98.52');
    });
  });

  describe('convertToJSON', () => {
    it('should return empty array for empty transactions array', () => {
      const result = convertToJSON([]);
      expect(result).toBe('[]');
    });

    it('should convert single transaction to JSON', () => {
      const transaction = createTransaction({
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
      });

      const result = convertToJSON([transaction]);
      const parsed = JSON.parse(result) as unknown[];

      expect(parsed).toHaveLength(1);
      const tx = parsed[0] as {
        fees: { total?: unknown };
        id: string;
        movements: { primary: { amount: string; assetSymbol: string; direction: string } };
        operation: { category: string; type: string };
        platformKey: string;
      };
      expect(tx.id).toBe(1);
      expect(tx.platformKey).toBe('kraken');
      expect(tx.operation.category).toBe('trade');
      expect(tx.operation.type).toBe('buy');
      expect(tx.fees.total).toBeUndefined();
    });

    it('should convert multiple transactions to JSON', () => {
      const transactions: Transaction[] = [
        createTransaction({
          movements: {
            inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
            outflows: [],
          },
        }),
        createTransaction({
          id: 2,
          txFingerprint: 'ext-2',
          datetime: '2024-01-02T12:00:00Z',
          timestamp: Date.parse('2024-01-02T12:00:00Z'),
          movements: {
            inflows: [],
            outflows: [{ assetId: 'test:eth', assetSymbol: 'ETH' as Currency, grossAmount: parseDecimal('10.0') }],
          },
          operation: {
            category: 'trade',
            type: 'sell',
          },
        }),
      ];

      const result = convertToJSON(transactions);
      const parsed = JSON.parse(result) as unknown[];

      expect(parsed).toHaveLength(2);
      expect((parsed[0] as { id: string }).id).toBe(1);
      expect((parsed[1] as { id: string }).id).toBe(2);
    });

    it('should include blockchain information when present', () => {
      const transaction = createTransaction({
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
        blockchain: {
          name: 'bitcoin',
          block_height: 800000,
          transaction_hash: '0xabc123',
          is_confirmed: true,
        },
      });

      const result = convertToJSON([transaction]);
      const parsed = JSON.parse(result) as {
        blockchain: {
          block_height?: number;
          is_confirmed: boolean;
          name: string;
          transaction_hash: string;
        };
      }[];

      expect(parsed[0]).toBeDefined();
      expect(parsed[0]?.blockchain).toBeDefined();
      expect(parsed[0]?.blockchain?.name).toBe('bitcoin');
      expect(parsed[0]?.blockchain?.block_height).toBe(800000);
      expect(parsed[0]?.blockchain?.transaction_hash).toBe('0xabc123');
      expect(parsed[0]?.blockchain?.is_confirmed).toBe(true);
    });

    it('should format JSON with proper indentation', () => {
      const transaction = createTransaction({
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
      });

      const result = convertToJSON([transaction]);

      // Should contain proper indentation (2 spaces)
      expect(result).toContain('  "id"');
      expect(result).toContain('  "operation"');
      expect(result).toContain('    "category"');
    });
  });

  describe('convertToNormalizedCSV', () => {
    it('should convert transactions into normalized CSV files', () => {
      const transaction = createTransaction({
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.5') }],
          outflows: [{ assetId: 'test:usd', assetSymbol: 'USD' as Currency, grossAmount: parseDecimal('30000') }],
        },
        fees: [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            amount: parseDecimal('10'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
        diagnostics: [
          {
            code: 'classification_uncertain',
            message: 'Needs review',
            severity: 'warning',
            metadata: { source: 'provider' },
          },
        ],
        userNotes: [
          {
            message: 'Cold storage transfer',
            createdAt: '2026-03-15T12:00:00.000Z',
            author: 'user',
          },
        ],
      });

      const link: TransactionLink = {
        id: 1,
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:source:btc',
        targetAssetId: 'blockchain:target:btc',
        sourceAmount: parseDecimal('1.5'),
        targetAmount: parseDecimal('1.49'),
        sourceMovementFingerprint: 'movement:exchange:source:1:btc:outflow:0',
        targetMovementFingerprint: 'movement:blockchain:target:2:btc:inflow:0',
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.99'),
          timingValid: true,
          timingHours: 2,
        },
        status: 'confirmed',
        reviewedBy: 'system',
        reviewedAt: new Date('2024-01-02T00:00:00Z'),
        createdAt: new Date('2024-01-02T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      };

      const result = convertToNormalizedCSV([transaction], [link]);

      expect(result.transactionsCsv).toContain('id,tx_fingerprint,account_id');
      expect(result.transactionsCsv).toContain('1,ext-1,1,kraken,trade,buy');
      expect(result.movementsCsv).toContain('tx_id,direction,asset_id,asset_symbol');
      expect(result.movementsCsv).toContain('1,in,test:btc,BTC,1.5');
      expect(result.movementsCsv).toContain('1,out,test:usd,USD,30000');
      expect(result.feesCsv).toContain('tx_id,asset_id,asset_symbol,amount');
      expect(result.feesCsv).toContain('1,test:usd,USD,10,platform,balance');
      expect(result.diagnosticsCsv).toContain('tx_id,code,severity,message,metadata_json');
      expect(result.diagnosticsCsv).toContain('1,classification_uncertain,warning,Needs review');
      expect(result.userNotesCsv).toContain('tx_id,created_at,author,message');
      expect(result.userNotesCsv).toContain('1,2026-03-15T12:00:00.000Z,user,Cold storage transfer');
      expect(result.linksCsv).toContain('link_id,source_transaction_id,target_transaction_id');
      expect(result.linksCsv).toContain('1,1,2,BTC,1.5,1.49');
    });
  });
});
