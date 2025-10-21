import { describe, expect, it } from 'vitest';

import {
  buildProcessParamsFromFlags,
  parseTimestamp,
  validateProcessParams,
  type ProcessCommandOptions,
  type ProcessHandlerParams,
} from '../process-utils.ts';

describe('process-utils', () => {
  describe('validateProcessParams', () => {
    it('should succeed for valid exchange params', () => {
      const params: ProcessHandlerParams = {
        sourceName: 'kraken',
        sourceType: 'exchange',
        filters: {},
      };

      const result = validateProcessParams(params);
      expect(result.isOk()).toBe(true);
    });

    it('should succeed for valid blockchain params', () => {
      const params: ProcessHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        filters: {},
      };

      const result = validateProcessParams(params);
      expect(result.isOk()).toBe(true);
    });

    it('should fail when source name is missing', () => {
      const params: ProcessHandlerParams = {
        sourceName: '',
        sourceType: 'exchange',
        filters: {},
      };

      const result = validateProcessParams(params);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Source name is required');
    });

    it('should fail for invalid source type', () => {
      const params: ProcessHandlerParams = {
        sourceName: 'test',
        sourceType: 'invalid' as 'exchange',
        filters: {},
      };

      const result = validateProcessParams(params);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Source type must be either "exchange" or "blockchain"');
    });
  });

  describe('parseTimestamp', () => {
    it('should parse Unix timestamp in milliseconds', () => {
      const result = parseTimestamp('1609459200000');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1609459200); // Converted to seconds
    });

    it('should parse Unix timestamp in seconds', () => {
      const result = parseTimestamp('1609459200');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1609459); // Converted to seconds (1609459200 / 1000 = 1609459.2, floored)
    });

    it('should parse ISO date string', () => {
      const result = parseTimestamp('2021-01-01');
      expect(result.isOk()).toBe(true);
      // Should be a valid timestamp in seconds
      expect(result._unsafeUnwrap()).toBeGreaterThan(0);
    });

    it('should parse full ISO datetime string', () => {
      const result = parseTimestamp('2021-01-01T00:00:00Z');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1609459200); // 2021-01-01 00:00:00 UTC in seconds
    });

    it('should fail for invalid date string', () => {
      const result = parseTimestamp('invalid-date');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid date format');
    });

    it('should fail for empty string', () => {
      const result = parseTimestamp('');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid date format');
    });
  });

  describe('buildProcessParamsFromFlags', () => {
    describe('source selection validation', () => {
      it('should fail when neither exchange nor blockchain is provided', () => {
        const options: ProcessCommandOptions = {};

        const result = buildProcessParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain('Either --exchange or --blockchain is required');
      });

      it('should fail when both exchange and blockchain are provided', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
          blockchain: 'bitcoin',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe('Cannot specify both --exchange and --blockchain. Choose one.');
      });
    });

    describe('exchange source', () => {
      it('should build params for exchange with no filters', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('kraken');
        expect(params.sourceType).toBe('exchange');
        expect(params.filters).toEqual({});
      });

      it('should build params for exchange with session ID', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
          session: '123',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.filters.dataSourceId).toBe(123);
      });

      it('should build params for exchange with since filter', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
          since: '2021-01-01',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.filters.createdAfter).toBeGreaterThan(0);
      });

      it('should build params for exchange with both session and since', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kucoin',
          session: '456',
          since: '1609459200000',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.filters.dataSourceId).toBe(456);
        expect(params.filters.createdAfter).toBe(1609459200);
      });

      it('should fail for invalid session ID', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
          session: 'invalid',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain('Invalid session ID');
      });

      it('should fail for negative session ID', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
          session: '-1',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain('Invalid session ID');
      });

      it('should fail for zero session ID', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
          session: '0',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain('Invalid session ID');
      });

      it('should fail for invalid since date', () => {
        const options: ProcessCommandOptions = {
          exchange: 'kraken',
          since: 'not-a-date',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain('Invalid date format');
      });
    });

    describe('blockchain source', () => {
      it('should build params for blockchain with no filters', () => {
        const options: ProcessCommandOptions = {
          blockchain: 'bitcoin',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('bitcoin');
        expect(params.sourceType).toBe('blockchain');
        expect(params.filters).toEqual({});
      });

      it('should build params for blockchain with session ID', () => {
        const options: ProcessCommandOptions = {
          blockchain: 'ethereum',
          session: '789',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('ethereum');
        expect(params.filters.dataSourceId).toBe(789);
      });

      it('should build params for blockchain with since filter', () => {
        const options: ProcessCommandOptions = {
          blockchain: 'polkadot',
          since: '2021-06-15',
        };

        const result = buildProcessParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('polkadot');
        expect(params.filters.createdAfter).toBeGreaterThan(0);
      });
    });
  });
});
