import type { TransactionLink } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, it, expect } from 'vitest';

import {
  buildExportParamsFromFlags,
  convertToCSV,
  convertToNormalizedCSV,
  convertToJSON,
  parseSinceDate,
  type ExportCommandOptions,
} from '../transactions-export-utils.js';

describe('export-utils', () => {
  describe('parseSinceDate', () => {
    it('should parse "0" as 0 timestamp', () => {
      const result = parseSinceDate('0');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
    });

    it('should parse ISO date string', () => {
      const result = parseSinceDate('2024-01-01');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(Date.parse('2024-01-01'));
    });

    it('should parse ISO datetime string', () => {
      const result = parseSinceDate('2024-01-01T00:00:00Z');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(Date.parse('2024-01-01T00:00:00Z'));
    });

    it('should reject invalid date format', () => {
      const result = parseSinceDate('not-a-date');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid date format');
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

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.format).toBe('csv');
      expect(params.csvFormat).toBe('normalized');
      expect(params.outputPath).toBe('data/transactions.csv');
      expect(params.sourceName).toBeUndefined();
      expect(params.since).toBeUndefined();
    });

    it('should build params with exchange source', () => {
      const options: ExportCommandOptions = {
        exchange: 'kraken',
        format: 'json',
        output: './exports/kraken.json',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('kraken');
      expect(params.format).toBe('json');
      expect(params.csvFormat).toBeUndefined();
      expect(params.outputPath).toBe('./exports/kraken.json');
    });

    it('should build params with blockchain source', () => {
      const options: ExportCommandOptions = {
        blockchain: 'bitcoin',
        format: 'csv',
        output: './exports/bitcoin.csv',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('bitcoin');
      expect(params.format).toBe('csv');
      expect(params.csvFormat).toBe('normalized');
    });

    it('should build params with since date', () => {
      const options: ExportCommandOptions = {
        since: '2024-01-01',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.since).toBe(Date.parse('2024-01-01'));
    });

    it('should build params with since set to 0', () => {
      const options: ExportCommandOptions = {
        since: '0',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.since).toBe(0);
    });

    it('should build params with csv format override', () => {
      const options: ExportCommandOptions = {
        format: 'csv',
        csvFormat: 'simple',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.format).toBe('csv');
      expect(params.csvFormat).toBe('simple');
    });

    it('should reject csv format when exporting json', () => {
      const options: ExportCommandOptions = {
        format: 'json',
        csvFormat: 'simple',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('--csv-format');
    });

    it('should reject invalid since date', () => {
      const options: ExportCommandOptions = {
        since: 'invalid-date',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid date format');
    });
  });

  describe('convertToCSV', () => {
    it('should return empty string for empty transactions array', () => {
      const result = convertToCSV([]);
      expect(result).toBe('');
    });

    it('should convert single transaction to CSV', () => {
      const transaction: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'trade',
          type: 'buy',
        },
      };

      const result = convertToCSV([transaction]);

      expect(result).toContain('id,external_id,source,operation_category');
      expect(result).toContain('1,ext-1,kraken,trade,buy');
      expect(result).toContain('BTC,1.5');
    });

    it('should convert multiple transactions to CSV', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          source: 'kraken',
          sourceType: 'exchange',
          datetime: '2024-01-01T12:00:00Z',
          timestamp: Date.parse('2024-01-01T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
            outflows: [],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        {
          id: 2,
          accountId: 1,
          externalId: 'ext-2',
          source: 'kraken',
          sourceType: 'exchange',
          datetime: '2024-01-02T12:00:00Z',
          timestamp: Date.parse('2024-01-02T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [],
            outflows: [{ assetId: 'test:eth', assetSymbol: 'ETH', grossAmount: parseDecimal('10.0') }],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'sell',
          },
        },
      ];

      const result = convertToCSV(transactions);
      const lines = result.split('\n');

      expect(lines).toHaveLength(3); // header + 2 rows
      expect(lines[0]).toContain('id,external_id,source,operation_category');
      expect(lines[1]).toContain('1,ext-1,kraken,trade,buy');
      expect(lines[2]).toContain('2,ext-2,kraken,trade,sell');
    });

    it('should escape values with commas', () => {
      const transaction: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        source: 'test,source',
        sourceType: 'exchange',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'trade',
          type: 'buy',
        },
      };

      const result = convertToCSV([transaction]);

      expect(result).toContain('"test,source"');
    });

    it('should include both inflow and outflow movements for swaps', () => {
      const transaction: UniversalTransactionData = {
        id: 1822,
        accountId: 1,
        externalId: 'ext-1822',
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2024-01-03T12:00:00Z',
        timestamp: Date.parse('2024-01-03T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ assetId: 'test:stx', assetSymbol: 'STX', grossAmount: parseDecimal('59.289') }],
          outflows: [{ assetId: 'test:cad', assetSymbol: 'CAD', grossAmount: parseDecimal('98.52') }],
        },
        fees: [],
        operation: {
          category: 'trade',
          type: 'swap',
        },
      };

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
      const transaction: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'trade',
          type: 'buy',
        },
      };

      const result = convertToJSON([transaction]);
      const parsed = JSON.parse(result) as unknown[];

      expect(parsed).toHaveLength(1);
      const tx = parsed[0] as {
        fees: { total?: unknown };
        id: string;
        movements: { primary: { amount: string; assetSymbol: string; direction: string } };
        operation: { category: string; type: string };
        source: string;
      };
      expect(tx.id).toBe(1);
      expect(tx.source).toBe('kraken');
      expect(tx.operation.category).toBe('trade');
      expect(tx.operation.type).toBe('buy');
      expect(tx.fees.total).toBeUndefined();
    });

    it('should convert multiple transactions to JSON', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          source: 'kraken',
          sourceType: 'exchange',
          datetime: '2024-01-01T12:00:00Z',
          timestamp: Date.parse('2024-01-01T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
            outflows: [],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        {
          id: 2,
          accountId: 1,
          externalId: 'ext-2',
          source: 'kraken',
          sourceType: 'exchange',
          datetime: '2024-01-02T12:00:00Z',
          timestamp: Date.parse('2024-01-02T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [],
            outflows: [{ assetId: 'test:eth', assetSymbol: 'ETH', grossAmount: parseDecimal('10.0') }],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'sell',
          },
        },
      ];

      const result = convertToJSON(transactions);
      const parsed = JSON.parse(result) as unknown[];

      expect(parsed).toHaveLength(2);
      expect((parsed[0] as { id: string }).id).toBe(1);
      expect((parsed[1] as { id: string }).id).toBe(2);
    });

    it('should include blockchain information when present', () => {
      const transaction: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        source: 'bitcoin',
        sourceType: 'blockchain',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        fees: [],
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
      };

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
      const transaction: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'trade',
          type: 'buy',
        },
      };

      const result = convertToJSON([transaction]);

      // Should contain proper indentation (2 spaces)
      expect(result).toContain('  "id"');
      expect(result).toContain('  "operation"');
      expect(result).toContain('    "category"');
    });
  });

  describe('convertToNormalizedCSV', () => {
    it('should convert transactions into normalized CSV files', () => {
      const transaction: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('1.5') }],
          outflows: [{ assetId: 'test:usd', assetSymbol: 'USD', grossAmount: parseDecimal('30000') }],
        },
        fees: [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD',
            amount: parseDecimal('10'),
            scope: 'platform',
            settlement: 'balance',
          },
        ],
        operation: {
          category: 'trade',
          type: 'buy',
        },
      };

      const link: TransactionLink = {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAmount: parseDecimal('1.5'),
        targetAmount: parseDecimal('1.49'),
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

      expect(result.transactionsCsv).toContain('id,external_id,account_id');
      expect(result.transactionsCsv).toContain('1,ext-1,1,kraken,trade,buy');
      expect(result.movementsCsv).toContain('tx_id,direction,asset_id,asset_symbol');
      expect(result.movementsCsv).toContain('1,in,test:btc,BTC,1.5');
      expect(result.movementsCsv).toContain('1,out,test:usd,USD,30000');
      expect(result.feesCsv).toContain('tx_id,asset_id,asset_symbol,amount');
      expect(result.feesCsv).toContain('1,test:usd,USD,10,platform,balance');
      expect(result.linksCsv).toContain('link_id,source_transaction_id,target_transaction_id');
      expect(result.linksCsv).toContain('link-1,1,2,BTC,1.5,1.49');
    });
  });
});
