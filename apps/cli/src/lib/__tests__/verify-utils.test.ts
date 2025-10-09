import { describe, expect, it } from 'vitest';

import {
  buildVerifyParamsFromFlags,
  validateVerifyParams,
  type VerifyCommandOptions,
  type VerifyHandlerParams,
} from '../verify-utils.ts';

describe('verify-utils', () => {
  describe('validateVerifyParams', () => {
    it('should succeed for valid params with source name', () => {
      const params: VerifyHandlerParams = {
        sourceName: 'kraken',
        generateReport: false,
      };

      const result = validateVerifyParams(params);
      expect(result.isOk()).toBe(true);
    });

    it('should succeed for valid params with report enabled', () => {
      const params: VerifyHandlerParams = {
        sourceName: 'bitcoin',
        generateReport: true,
      };

      const result = validateVerifyParams(params);
      expect(result.isOk()).toBe(true);
    });

    it('should fail when source name is missing', () => {
      const params: VerifyHandlerParams = {
        sourceName: '',
        generateReport: false,
      };

      const result = validateVerifyParams(params);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Source name is required');
    });
  });

  describe('buildVerifyParamsFromFlags', () => {
    describe('source selection validation', () => {
      it('should fail when neither exchange nor blockchain is provided', () => {
        const options: VerifyCommandOptions = {};

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toContain('Either --exchange or --blockchain is required');
      });

      it('should fail when both exchange and blockchain are provided', () => {
        const options: VerifyCommandOptions = {
          exchange: 'kraken',
          blockchain: 'bitcoin',
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().message).toBe('Cannot specify both --exchange and --blockchain. Choose one.');
      });
    });

    describe('exchange source', () => {
      it('should build params for exchange without report', () => {
        const options: VerifyCommandOptions = {
          exchange: 'kraken',
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('kraken');
        expect(params.generateReport).toBe(false);
      });

      it('should build params for exchange with report enabled', () => {
        const options: VerifyCommandOptions = {
          exchange: 'kraken',
          report: true,
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('kraken');
        expect(params.generateReport).toBe(true);
      });

      it('should build params for kucoin', () => {
        const options: VerifyCommandOptions = {
          exchange: 'kucoin',
          report: false,
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('kucoin');
        expect(params.generateReport).toBe(false);
      });

      it('should build params for ledgerlive', () => {
        const options: VerifyCommandOptions = {
          exchange: 'ledgerlive',
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('ledgerlive');
        expect(params.generateReport).toBe(false);
      });
    });

    describe('blockchain source', () => {
      it('should build params for blockchain without report', () => {
        const options: VerifyCommandOptions = {
          blockchain: 'bitcoin',
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('bitcoin');
        expect(params.generateReport).toBe(false);
      });

      it('should build params for blockchain with report enabled', () => {
        const options: VerifyCommandOptions = {
          blockchain: 'ethereum',
          report: true,
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('ethereum');
        expect(params.generateReport).toBe(true);
      });

      it('should build params for polkadot', () => {
        const options: VerifyCommandOptions = {
          blockchain: 'polkadot',
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('polkadot');
        expect(params.generateReport).toBe(false);
      });

      it('should build params for solana with report', () => {
        const options: VerifyCommandOptions = {
          blockchain: 'solana',
          report: true,
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);

        const params = result._unsafeUnwrap();
        expect(params.sourceName).toBe('solana');
        expect(params.generateReport).toBe(true);
      });
    });

    describe('report flag', () => {
      it('should default to false when report is not specified', () => {
        const options: VerifyCommandOptions = {
          exchange: 'kraken',
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().generateReport).toBe(false);
      });

      it('should handle explicit false report flag', () => {
        const options: VerifyCommandOptions = {
          exchange: 'kraken',
          report: false,
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().generateReport).toBe(false);
      });

      it('should handle explicit true report flag', () => {
        const options: VerifyCommandOptions = {
          blockchain: 'bitcoin',
          report: true,
        };

        const result = buildVerifyParamsFromFlags(options);
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().generateReport).toBe(true);
      });
    });
  });
});
