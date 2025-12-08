import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, it, expect } from 'vitest';

import {
  buildExportParamsFromFlags,
  convertToCSV,
  convertToJSON,
  parseSinceDate,
  type ExportCommandOptions,
} from '../export-utils.js';

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
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.5') }],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'trade',
          type: 'buy',
        },
      };

      const result = convertToCSV([transaction]);

      expect(result).toContain('id,source,operation_category');
      expect(result).toContain('1,kraken,trade,buy');
      expect(result).toContain('BTC,1.5,in');
    });

    it('should convert multiple transactions to CSV', () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'ext-1',
          source: 'kraken',
          datetime: '2024-01-01T12:00:00Z',
          timestamp: Date.parse('2024-01-01T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.5') }],
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
          datetime: '2024-01-02T12:00:00Z',
          timestamp: Date.parse('2024-01-02T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [],
            outflows: [{ asset: 'ETH', grossAmount: parseDecimal('10.0') }],
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
      expect(lines[0]).toContain('id,source,operation_category');
      expect(lines[1]).toContain('1,kraken,trade,buy');
      expect(lines[2]).toContain('2,kraken,trade,sell');
    });

    it('should escape values with commas', () => {
      const transaction: UniversalTransactionData = {
        id: 1,
        accountId: 1,
        externalId: 'ext-1',
        source: 'test,source',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.5') }],
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
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.5') }],
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
        movements: { primary: { amount: string; asset: string; direction: string } };
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
          datetime: '2024-01-01T12:00:00Z',
          timestamp: Date.parse('2024-01-01T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.5') }],
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
          datetime: '2024-01-02T12:00:00Z',
          timestamp: Date.parse('2024-01-02T12:00:00Z'),
          status: 'success',
          movements: {
            inflows: [],
            outflows: [{ asset: 'ETH', grossAmount: parseDecimal('10.0') }],
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
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.5') }],
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
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.5') }],
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
});
