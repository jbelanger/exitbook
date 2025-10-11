/* eslint-disable unicorn/no-null -- db requires explicit null */
import type { StoredTransaction } from '@exitbook/data';
import { describe, it, expect } from 'vitest';

import {
  buildExportParamsFromFlags,
  convertToCSV,
  convertToJSON,
  parseSinceDate,
  validateExportFormat,
  validateExportParams,
  type ExportCommandOptions,
  type ExportHandlerParams,
} from '../export-utils.ts';

describe('export-utils', () => {
  describe('validateExportFormat', () => {
    it('should accept valid csv format', () => {
      const result = validateExportFormat('csv');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('csv');
    });

    it('should accept valid json format', () => {
      const result = validateExportFormat('json');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('json');
    });

    it('should reject invalid format', () => {
      const result = validateExportFormat('xml');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid format: xml');
    });

    it('should reject empty format', () => {
      const result = validateExportFormat('');
      expect(result.isErr()).toBe(true);
    });
  });

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

    it('should reject both exchange and blockchain', () => {
      const options: ExportCommandOptions = {
        exchange: 'kraken',
        blockchain: 'bitcoin',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Cannot specify both --exchange and --blockchain');
    });

    it('should reject invalid format', () => {
      const options: ExportCommandOptions = {
        format: 'xml',
      };
      const result = buildExportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid format');
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

  describe('validateExportParams', () => {
    it('should validate correct params', () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };
      const result = validateExportParams(params);

      expect(result.isOk()).toBe(true);
    });

    it('should validate params with source and since', () => {
      const params: ExportHandlerParams = {
        sourceName: 'kraken',
        format: 'json',
        outputPath: './data/kraken.json',
        since: Date.parse('2024-01-01'),
      };
      const result = validateExportParams(params);

      expect(result.isOk()).toBe(true);
    });

    it('should reject missing format', () => {
      const params = {
        outputPath: './data/transactions.csv',
      } as ExportHandlerParams;
      const result = validateExportParams(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Export format is required');
    });

    it('should reject missing output path', () => {
      const params = {
        format: 'csv',
      } as ExportHandlerParams;
      const result = validateExportParams(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Output path is required');
    });
  });

  describe('convertToCSV', () => {
    it('should return empty string for empty transactions array', () => {
      const result = convertToCSV([]);
      expect(result).toBe('');
    });

    it('should convert single transaction to CSV', () => {
      const transaction: StoredTransaction = {
        id: 1,
        external_id: 'ext-1',
        source_id: 'kraken',
        source_type: 'exchange',
        import_session_id: 123,
        wallet_address_id: null,
        operation_category: 'trade',
        operation_type: 'buy',
        transaction_datetime: '2024-01-01T12:00:00Z',
        transaction_status: 'confirmed',
        from_address: null,
        to_address: null,
        movements_primary_asset: 'BTC',
        movements_primary_amount: '1.5',
        movements_primary_currency: null,
        movements_primary_direction: 'in',
        movements_inflows: null,
        movements_outflows: null,
        fees_total: null,
        fees_network: null,
        fees_platform: null,
        price: '50000',
        price_currency: 'USD',
        note_type: null,
        note_severity: null,
        note_message: null,
        note_metadata: null,
        raw_normalized_data: '{}',
        blockchain_name: null,
        blockchain_block_height: null,
        blockchain_transaction_hash: null,
        blockchain_is_confirmed: null,
        verified: false,
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
        price_at_tx_time: null,
        price_at_tx_time_currency: null,
        price_at_tx_time_source: null,
        price_at_tx_time_fetched_at: null,
      };

      const result = convertToCSV([transaction]);

      expect(result).toContain('id,source,operation_category');
      expect(result).toContain('1,kraken,trade,buy');
      expect(result).toContain('BTC,1.5,in');
      expect(result).toContain('50000,USD,confirmed');
    });

    it('should convert multiple transactions to CSV', () => {
      const transactions: StoredTransaction[] = [
        {
          id: 1,
          external_id: 'ext-1',
          source_id: 'kraken',
          source_type: 'exchange',
          import_session_id: 123,
          wallet_address_id: null,
          operation_category: 'trade',
          operation_type: 'buy',
          transaction_datetime: '2024-01-01T12:00:00Z',
          transaction_status: 'confirmed',
          from_address: null,
          to_address: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.5',
          movements_primary_currency: null,
          movements_primary_direction: 'in',
          movements_inflows: null,
          movements_outflows: null,
          fees_total: null,
          fees_network: null,
          fees_platform: null,
          price: '50000',
          price_currency: 'USD',
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          raw_normalized_data: '{}',
          blockchain_name: null,
          blockchain_block_height: null,
          blockchain_transaction_hash: null,
          blockchain_is_confirmed: null,
          price_at_tx_time: null,
          price_at_tx_time_currency: null,
          price_at_tx_time_source: null,
          price_at_tx_time_fetched_at: null,
          verified: false,
          created_at: '2024-01-01T12:00:00Z',
          updated_at: '2024-01-01T12:00:00Z',
        },
        {
          id: 2,
          external_id: 'ext-2',
          source_id: 'kraken',
          source_type: 'exchange',
          import_session_id: 123,
          wallet_address_id: null,
          operation_category: 'trade',
          operation_type: 'sell',
          transaction_datetime: '2024-01-02T12:00:00Z',
          transaction_status: 'confirmed',
          from_address: null,
          to_address: null,
          movements_primary_asset: 'ETH',
          movements_primary_amount: '10.0',
          movements_primary_currency: null,
          movements_primary_direction: 'out',
          movements_inflows: null,
          movements_outflows: null,
          fees_total: null,
          fees_network: null,
          fees_platform: null,
          price: '3000',
          price_currency: 'USD',
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          raw_normalized_data: '{}',
          blockchain_name: null,
          blockchain_block_height: null,
          blockchain_transaction_hash: null,
          blockchain_is_confirmed: null,
          price_at_tx_time: null,
          price_at_tx_time_currency: null,
          price_at_tx_time_source: null,
          price_at_tx_time_fetched_at: null,
          verified: false,
          created_at: '2024-01-02T12:00:00Z',
          updated_at: '2024-01-02T12:00:00Z',
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
      const transaction: StoredTransaction = {
        id: 1,
        external_id: 'ext-1',
        source_id: 'test,source',
        source_type: 'exchange',
        import_session_id: 123,
        wallet_address_id: null,
        operation_category: 'trade',
        operation_type: 'buy',
        transaction_datetime: '2024-01-01T12:00:00Z',
        transaction_status: 'confirmed',
        from_address: null,
        to_address: null,
        movements_primary_asset: 'BTC',
        movements_primary_amount: '1.5',
        movements_primary_currency: null,
        movements_primary_direction: 'in',
        movements_inflows: null,
        movements_outflows: null,
        fees_total: null,
        fees_network: null,
        fees_platform: null,
        price: '50000',
        price_currency: 'USD',
        note_type: null,
        note_severity: null,
        note_message: null,
        note_metadata: null,
        raw_normalized_data: '{}',
        blockchain_name: null,
        blockchain_block_height: null,
        blockchain_transaction_hash: null,
        blockchain_is_confirmed: null,
        verified: false,
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
        price_at_tx_time: null,
        price_at_tx_time_currency: null,
        price_at_tx_time_source: null,
        price_at_tx_time_fetched_at: null,
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
      const transaction: StoredTransaction = {
        id: 1,
        external_id: 'ext-1',
        source_id: 'kraken',
        source_type: 'exchange',
        import_session_id: 123,
        wallet_address_id: null,
        operation_category: 'trade',
        operation_type: 'buy',
        transaction_datetime: '2024-01-01T12:00:00Z',
        transaction_status: 'confirmed',
        from_address: null,
        to_address: null,
        movements_primary_asset: 'BTC',
        movements_primary_amount: '1.5',
        movements_primary_currency: null,
        movements_primary_direction: 'in',
        movements_inflows: null,
        movements_outflows: null,
        fees_total: null,
        fees_network: null,
        fees_platform: null,
        price: '50000',
        price_currency: 'USD',
        note_type: null,
        note_severity: null,
        note_message: null,
        note_metadata: null,
        raw_normalized_data: '{}',
        blockchain_name: null,
        blockchain_block_height: null,
        blockchain_transaction_hash: null,
        blockchain_is_confirmed: null,
        verified: false,
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
        price_at_tx_time: null,
        price_at_tx_time_currency: null,
        price_at_tx_time_source: null,
        price_at_tx_time_fetched_at: null,
      };

      const result = convertToJSON([transaction]);
      const parsed = JSON.parse(result) as unknown[];

      expect(parsed).toHaveLength(1);
      const tx = parsed[0] as {
        fees: { total: unknown };
        id: number;
        movements: { primary: { amount: string; asset: string; direction: string } };
        operation: { category: string; type: string };
        price: string;
        price_currency: string;
        source_id: string;
      };
      expect(tx.id).toBe(1);
      expect(tx.source_id).toBe('kraken');
      expect(tx.operation.category).toBe('trade');
      expect(tx.operation.type).toBe('buy');
      expect(tx.movements.primary.asset).toBe('BTC');
      expect(tx.movements.primary.amount).toBe('1.5');
      expect(tx.movements.primary.direction).toBe('in');
      expect(tx.fees.total).toBe(null);
      expect(tx.price).toBe('50000');
      expect(tx.price_currency).toBe('USD');
    });

    it('should convert multiple transactions to JSON', () => {
      const transactions: StoredTransaction[] = [
        {
          id: 1,
          external_id: 'ext-1',
          source_id: 'kraken',
          source_type: 'exchange',
          import_session_id: 123,
          wallet_address_id: null,
          operation_category: 'trade',
          operation_type: 'buy',
          transaction_datetime: '2024-01-01T12:00:00Z',
          transaction_status: 'confirmed',
          from_address: null,
          to_address: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.5',
          movements_primary_currency: null,
          movements_primary_direction: 'in',
          movements_inflows: null,
          movements_outflows: null,
          fees_total: null,
          fees_network: null,
          fees_platform: null,
          price: '50000',
          price_currency: 'USD',
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          raw_normalized_data: '{}',
          blockchain_name: null,
          blockchain_block_height: null,
          blockchain_transaction_hash: null,
          blockchain_is_confirmed: null,
          verified: false,
          created_at: '2024-01-01T12:00:00Z',
          updated_at: '2024-01-01T12:00:00Z',
          price_at_tx_time: null,
          price_at_tx_time_currency: null,
          price_at_tx_time_source: null,
          price_at_tx_time_fetched_at: null,
        },
        {
          id: 2,
          external_id: 'ext-2',
          source_id: 'kraken',
          source_type: 'exchange',
          import_session_id: 123,
          wallet_address_id: null,
          operation_category: 'trade',
          operation_type: 'sell',
          transaction_datetime: '2024-01-02T12:00:00Z',
          transaction_status: 'confirmed',
          from_address: null,
          to_address: null,
          movements_primary_asset: 'ETH',
          movements_primary_amount: '10.0',
          movements_primary_currency: null,
          movements_primary_direction: 'out',
          movements_inflows: null,
          movements_outflows: null,
          fees_total: null,
          fees_network: null,
          fees_platform: null,
          price: '3000',
          price_currency: 'USD',
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          raw_normalized_data: '{}',
          blockchain_name: null,
          blockchain_block_height: null,
          blockchain_transaction_hash: null,
          blockchain_is_confirmed: null,
          verified: false,
          created_at: '2024-01-02T12:00:00Z',
          updated_at: '2024-01-02T12:00:00Z',
          price_at_tx_time: null,
          price_at_tx_time_currency: null,
          price_at_tx_time_source: null,
          price_at_tx_time_fetched_at: null,
        },
      ];

      const result = convertToJSON(transactions);
      const parsed = JSON.parse(result) as unknown[];

      expect(parsed).toHaveLength(2);
      expect((parsed[0] as { id: number }).id).toBe(1);
      expect((parsed[1] as { id: number }).id).toBe(2);
    });

    it('should include blockchain information when present', () => {
      const transaction: StoredTransaction = {
        id: 1,
        external_id: 'ext-1',
        source_id: 'bitcoin',
        source_type: 'blockchain',
        import_session_id: 123,
        wallet_address_id: null,
        operation_category: 'transfer',
        operation_type: 'transfer',
        transaction_datetime: '2024-01-01T12:00:00Z',
        transaction_status: 'confirmed',
        from_address: null,
        to_address: null,
        movements_primary_asset: 'BTC',
        movements_primary_amount: '1.5',
        movements_primary_currency: null,
        movements_primary_direction: 'in',
        movements_inflows: null,
        movements_outflows: null,
        fees_total: null,
        fees_network: null,
        fees_platform: null,
        price: null,
        price_currency: null,
        note_type: null,
        note_severity: null,
        note_message: null,
        note_metadata: null,
        raw_normalized_data: '{}',
        blockchain_name: 'bitcoin',
        blockchain_block_height: 800000,
        blockchain_transaction_hash: '0xabc123',
        blockchain_is_confirmed: true,
        verified: false,
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
        price_at_tx_time: null,
        price_at_tx_time_currency: null,
        price_at_tx_time_source: null,
        price_at_tx_time_fetched_at: null,
      };

      const result = convertToJSON([transaction]);
      const parsed = JSON.parse(result) as {
        blockchain: {
          block_height: number | null;
          is_confirmed: boolean | null;
          name: string | null;
          transaction_hash: string | null;
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
      const transaction: StoredTransaction = {
        id: 1,
        external_id: 'ext-1',
        source_id: 'kraken',
        source_type: 'exchange',
        import_session_id: 123,
        wallet_address_id: null,
        operation_category: 'trade',
        operation_type: 'buy',
        transaction_datetime: '2024-01-01T12:00:00Z',
        transaction_status: 'confirmed',
        from_address: null,
        to_address: null,
        movements_primary_asset: 'BTC',
        movements_primary_amount: '1.5',
        movements_primary_currency: null,
        movements_primary_direction: 'in',
        movements_inflows: null,
        movements_outflows: null,
        fees_total: null,
        fees_network: null,
        fees_platform: null,
        price: '50000',
        price_currency: 'USD',
        note_type: null,
        note_severity: null,
        note_message: null,
        note_metadata: null,
        raw_normalized_data: '{}',
        blockchain_name: null,
        blockchain_block_height: null,
        blockchain_transaction_hash: null,
        blockchain_is_confirmed: null,
        verified: false,
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
        price_at_tx_time: null,
        price_at_tx_time_currency: null,
        price_at_tx_time_source: null,
        price_at_tx_time_fetched_at: null,
      };

      const result = convertToJSON([transaction]);

      // Should contain proper indentation (2 spaces)
      expect(result).toContain('  "id"');
      expect(result).toContain('  "operation"');
      expect(result).toContain('    "category"');
    });
  });
});
