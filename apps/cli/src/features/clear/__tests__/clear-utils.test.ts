import { describe, expect, it } from 'vitest';

import { buildClearParamsFromFlags, type ClearCommandOptions } from '../clear-utils.js';

describe('clear-utils', () => {
  describe('buildClearParamsFromFlags', () => {
    it('should build params with default values', () => {
      const options: ClearCommandOptions = {};
      const result = buildClearParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.includeRaw).toBe(false);
      expect(params.source).toBeUndefined();
    });

    it('should build params with source specified', () => {
      const options: ClearCommandOptions = {
        source: 'kraken',
      };
      const result = buildClearParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.source).toBe('kraken');
      expect(params.includeRaw).toBe(false);
    });

    it('should build params with includeRaw set to true', () => {
      const options: ClearCommandOptions = {
        includeRaw: true,
      };
      const result = buildClearParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.includeRaw).toBe(true);
      expect(params.source).toBeUndefined();
    });

    it('should build params with both source and includeRaw', () => {
      const options: ClearCommandOptions = {
        includeRaw: true,
        source: 'ethereum',
      };
      const result = buildClearParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.source).toBe('ethereum');
      expect(params.includeRaw).toBe(true);
    });

    it('should treat includeRaw false explicitly', () => {
      const options: ClearCommandOptions = {
        includeRaw: false,
      };
      const result = buildClearParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.includeRaw).toBe(false);
    });

    it('should handle all options together', () => {
      const options: ClearCommandOptions = {
        confirm: true,
        includeRaw: true,
        json: true,
        source: 'bitcoin',
      };
      const result = buildClearParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.source).toBe('bitcoin');
      expect(params.includeRaw).toBe(true);
      // confirm and json are not in handler params
    });
  });
});
