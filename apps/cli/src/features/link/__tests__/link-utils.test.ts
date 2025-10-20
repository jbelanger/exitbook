import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { LinkCommandOptions } from '../link-utils.ts';
import { buildLinkParamsFromFlags, validateLinkParams } from '../link-utils.ts';

describe('link-utils', () => {
  describe('validateLinkParams', () => {
    it('should accept valid parameters', () => {
      const result = validateLinkParams({
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      });
      expect(result.isOk()).toBe(true);
    });

    it('should accept parameters where autoConfirmThreshold equals minConfidenceScore', () => {
      const result = validateLinkParams({
        dryRun: false,
        minConfidenceScore: parseDecimal('0.8'),
        autoConfirmThreshold: parseDecimal('0.8'),
      });
      expect(result.isOk()).toBe(true);
    });

    it('should accept minimum valid confidence score (0)', () => {
      const result = validateLinkParams({
        dryRun: true,
        minConfidenceScore: parseDecimal('0'),
        autoConfirmThreshold: parseDecimal('0.5'),
      });
      expect(result.isOk()).toBe(true);
    });

    it('should accept maximum valid confidence score (1)', () => {
      const result = validateLinkParams({
        dryRun: true,
        minConfidenceScore: parseDecimal('0.9'),
        autoConfirmThreshold: parseDecimal('1'),
      });
      expect(result.isOk()).toBe(true);
    });

    it('should reject minConfidenceScore below 0', () => {
      const result = validateLinkParams({
        dryRun: false,
        minConfidenceScore: parseDecimal('-0.1'),
        autoConfirmThreshold: parseDecimal('0.95'),
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('minConfidenceScore must be between 0 and 1');
    });

    it('should reject minConfidenceScore above 1', () => {
      const result = validateLinkParams({
        dryRun: false,
        minConfidenceScore: parseDecimal('1.1'),
        autoConfirmThreshold: parseDecimal('0.95'),
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('minConfidenceScore must be between 0 and 1');
    });

    it('should reject autoConfirmThreshold below 0', () => {
      const result = validateLinkParams({
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('-0.1'),
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('autoConfirmThreshold must be between 0 and 1');
    });

    it('should reject autoConfirmThreshold above 1', () => {
      const result = validateLinkParams({
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('1.5'),
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('autoConfirmThreshold must be between 0 and 1');
    });

    it('should reject autoConfirmThreshold less than minConfidenceScore', () => {
      const result = validateLinkParams({
        dryRun: false,
        minConfidenceScore: parseDecimal('0.8'),
        autoConfirmThreshold: parseDecimal('0.7'),
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('autoConfirmThreshold must be >= minConfidenceScore');
    });
  });

  describe('buildLinkParamsFromFlags', () => {
    it('should build params with default values', () => {
      const options: LinkCommandOptions = {};
      const result = buildLinkParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.dryRun).toBe(false);
      expect(params.minConfidenceScore.toString()).toBe('0.7');
      expect(params.autoConfirmThreshold.toString()).toBe('0.95');
    });

    it('should build params with dry-run enabled', () => {
      const options: LinkCommandOptions = {
        dryRun: true,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.dryRun).toBe(true);
      expect(params.minConfidenceScore.toString()).toBe('0.7');
      expect(params.autoConfirmThreshold.toString()).toBe('0.95');
    });

    it('should build params with custom minConfidence', () => {
      const options: LinkCommandOptions = {
        minConfidence: 0.65,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.dryRun).toBe(false);
      expect(params.minConfidenceScore.toString()).toBe('0.65');
      expect(params.autoConfirmThreshold.toString()).toBe('0.95');
    });

    it('should build params with custom autoConfirmThreshold', () => {
      const options: LinkCommandOptions = {
        autoConfirmThreshold: 0.98,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.dryRun).toBe(false);
      expect(params.minConfidenceScore.toString()).toBe('0.7');
      expect(params.autoConfirmThreshold.toString()).toBe('0.98');
    });

    it('should build params with all custom values', () => {
      const options: LinkCommandOptions = {
        dryRun: true,
        minConfidence: 0.6,
        autoConfirmThreshold: 0.9,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.dryRun).toBe(true);
      expect(params.minConfidenceScore.toString()).toBe('0.6');
      expect(params.autoConfirmThreshold.toString()).toBe('0.9');
    });

    it('should accept minConfidence of 0', () => {
      const options: LinkCommandOptions = {
        minConfidence: 0,
        autoConfirmThreshold: 0.5,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.minConfidenceScore.toString()).toBe('0');
      expect(params.autoConfirmThreshold.toString()).toBe('0.5');
    });

    it('should accept maximum confidence values', () => {
      const options: LinkCommandOptions = {
        minConfidence: 1,
        autoConfirmThreshold: 1,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.minConfidenceScore.toString()).toBe('1');
      expect(params.autoConfirmThreshold.toString()).toBe('1');
    });

    it('should reject invalid minConfidence (above 1)', () => {
      const options: LinkCommandOptions = {
        minConfidence: 1.5,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('minConfidenceScore must be between 0 and 1');
    });

    it('should reject invalid minConfidence (below 0)', () => {
      const options: LinkCommandOptions = {
        minConfidence: -0.1,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('minConfidenceScore must be between 0 and 1');
    });

    it('should reject invalid autoConfirmThreshold (above 1)', () => {
      const options: LinkCommandOptions = {
        autoConfirmThreshold: 1.2,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('autoConfirmThreshold must be between 0 and 1');
    });

    it('should reject invalid autoConfirmThreshold (below 0)', () => {
      const options: LinkCommandOptions = {
        autoConfirmThreshold: -0.5,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('autoConfirmThreshold must be between 0 and 1');
    });

    it('should reject autoConfirmThreshold less than minConfidence', () => {
      const options: LinkCommandOptions = {
        minConfidence: 0.9,
        autoConfirmThreshold: 0.8,
      };
      const result = buildLinkParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('autoConfirmThreshold must be >= minConfidenceScore');
    });
  });
});
