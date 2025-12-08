import { describe, expect, it } from 'vitest';

import { buildLinksRunParamsFromFlags, type LinksRunCommandOptions } from './links-run-utils.js';

describe('buildLinksRunParamsFromFlags', () => {
  it('should build params with default values when no options provided', () => {
    const options: LinksRunCommandOptions = {};

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dryRun).toBe(false);
      expect(result.value.minConfidenceScore.toString()).toBe('0.7');
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.95');
    }
  });

  it('should use provided dryRun flag', () => {
    const options: LinksRunCommandOptions = {
      dryRun: true,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dryRun).toBe(true);
    }
  });

  it('should use provided minConfidence', () => {
    const options: LinksRunCommandOptions = {
      minConfidence: 0.8,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.minConfidenceScore.toString()).toBe('0.8');
    }
  });

  it('should use provided autoConfirmThreshold', () => {
    const options: LinksRunCommandOptions = {
      autoConfirmThreshold: 0.9,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.9');
    }
  });

  it('should use all provided options', () => {
    const options: LinksRunCommandOptions = {
      dryRun: true,
      minConfidence: 0.6,
      autoConfirmThreshold: 0.85,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dryRun).toBe(true);
      expect(result.value.minConfidenceScore.toString()).toBe('0.6');
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.85');
    }
  });

  it('should handle minConfidence of 0', () => {
    const options: LinksRunCommandOptions = {
      minConfidence: 0,
      autoConfirmThreshold: 0,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.minConfidenceScore.toString()).toBe('0');
    }
  });

  it('should handle minConfidence of 1', () => {
    const options: LinksRunCommandOptions = {
      minConfidence: 1,
      autoConfirmThreshold: 1,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.minConfidenceScore.toString()).toBe('1');
    }
  });

  it('should handle string inputs for numeric options', () => {
    // In commander, numeric flags can come as strings
    const options = {
      minConfidence: '0.75' as unknown as number,
      autoConfirmThreshold: '0.9' as unknown as number,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.minConfidenceScore.toString()).toBe('0.75');
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.9');
    }
  });

  it('should handle explicit undefined values', () => {
    const options: LinksRunCommandOptions = {
      dryRun: undefined,
      minConfidence: undefined,
      autoConfirmThreshold: undefined,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dryRun).toBe(false);
      expect(result.value.minConfidenceScore.toString()).toBe('0.7');
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.95');
    }
  });

  it('should handle decimal precision correctly', () => {
    const options: LinksRunCommandOptions = {
      minConfidence: 0.7777777,
      autoConfirmThreshold: 0.8888888,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.minConfidenceScore.toString()).toBe('0.7777777');
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.8888888');
    }
  });

  it('should handle very small decimal values', () => {
    const options: LinksRunCommandOptions = {
      minConfidence: 0.0001,
      autoConfirmThreshold: 0.0002,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.minConfidenceScore.toString()).toBe('0.0001');
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.0002');
    }
  });

  it('should handle values very close to boundaries', () => {
    const options: LinksRunCommandOptions = {
      minConfidence: 0.99999,
      autoConfirmThreshold: 0.99999,
    };

    const result = buildLinksRunParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.minConfidenceScore.toString()).toBe('0.99999');
      expect(result.value.autoConfirmThreshold.toString()).toBe('0.99999');
    }
  });
});
