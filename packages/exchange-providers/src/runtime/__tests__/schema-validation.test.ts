import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { validateCredentials, validateRawData } from '../schema-validation.js';

function assertErr<T, E>(result: { error?: E; isErr(): boolean; value?: T }): E {
  if (!result.isErr()) {
    throw new Error(`Expected Result to be Err, but got Ok: ${String(result.value)}`);
  }
  return result.error as E;
}

describe('validateCredentials', () => {
  const TestCredentialsSchema = z.object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
  });

  it('should succeed with valid credentials', () => {
    const credentials = { apiKey: 'test-key', apiSecret: 'test-secret' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(credentials);
    }
  });

  it('should fail with missing apiKey', () => {
    const credentials = { apiSecret: 'test-secret' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(assertErr(result).message).toContain('Invalid kraken credentials');
  });

  it('should fail with missing secret', () => {
    const credentials = { apiKey: 'test-key' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(assertErr(result).message).toContain('Invalid kraken credentials');
  });

  it('should fail with empty apiKey', () => {
    const credentials = { apiKey: '', apiSecret: 'test-secret' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(assertErr(result).message).toContain('Invalid kraken credentials');
  });

  it('should fail with empty secret', () => {
    const credentials = { apiKey: 'test-key', apiSecret: '' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(assertErr(result).message).toContain('Invalid kraken credentials');
  });

  it('should fail with extra unexpected fields', () => {
    const schema = z
      .object({
        apiKey: z.string(),
      })
      .strict();

    const credentials = { apiKey: 'test-key', unexpectedField: 'value' };

    const result = validateCredentials(schema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
  });

  it('should succeed with optional fields', () => {
    const schema = z.object({
      apiKey: z.string(),
      apiSecret: z.string(),
      apiPassphrase: z.string().optional(),
    });

    const credentials = { apiKey: 'test-key', apiSecret: 'test-secret', apiPassphrase: 'test-pass' };

    const result = validateCredentials(schema, credentials, 'kucoin');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(credentials);
    }
  });

  it('should succeed with optional fields omitted', () => {
    const schema = z.object({
      apiKey: z.string(),
      apiSecret: z.string(),
      apiPassphrase: z.string().optional(),
    });

    const credentials = { apiKey: 'test-key', apiSecret: 'test-secret' };

    const result = validateCredentials(schema, credentials, 'kucoin');

    expect(result.isOk()).toBe(true);
  });

  it('should include exchange name in error message', () => {
    const credentials = {};

    const result = validateCredentials(TestCredentialsSchema, credentials, 'binance');

    expect(result.isErr()).toBe(true);
    expect(assertErr(result).message).toContain('Invalid binance credentials');
  });

  it('should handle null credentials', () => {
    const result = validateCredentials(TestCredentialsSchema, undefined, 'kraken');

    expect(result.isErr()).toBe(true);
  });

  it('should handle undefined credentials', () => {
    const result = validateCredentials(TestCredentialsSchema, undefined, 'kraken');

    expect(result.isErr()).toBe(true);
  });
});

describe('validateRawData', () => {
  const TestDataSchema = z.object({
    id: z.string(),
    amount: z.string(),
    timestamp: z.number(),
  });

  it('should succeed with valid data', () => {
    const rawData = { id: 'tx-1', amount: '100', timestamp: 1704067200000 };

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(rawData);
    }
  });

  it('should fail with missing required field', () => {
    const rawData = { id: 'tx-1', amount: '100' };

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(assertErr(result).message).toContain('timestamp');
  });

  it('should fail with wrong type', () => {
    const rawData = { id: 'tx-1', amount: 100, timestamp: 1704067200000 }; // amount should be string

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(assertErr(result).message).toContain('amount');
  });

  it('should succeed with exact schema match', () => {
    const rawData = { id: 'tx-1', amount: '100', timestamp: 1704067200000 };

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe('tx-1');
      expect(result.value.amount).toBe('100');
      expect(result.value.timestamp).toBe(1704067200000);
    }
  });

  it('should handle array data', () => {
    const schema = z.array(z.object({ id: z.string() }));
    const rawData = [{ id: 'tx-1' }, { id: 'tx-2' }];

    const result = validateRawData(schema, rawData, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('should include validation errors', () => {
    const rawData = { invalid: 'data' };

    const result = validateRawData(TestDataSchema, rawData, 'binance');

    expect(result.isErr()).toBe(true);
    // Should contain field names from validation errors
    expect(assertErr(result).message).toContain('id');
  });
});
