/* eslint-disable unicorn/no-null -- null needed for db row fixtures */
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseJson, parseWithSchema, serializeToJson, toRawTransaction } from '../db-utils.js';

describe('serializeToJson', () => {
  it('returns undefined for null input', () => {
    expect(assertOk(serializeToJson(null))).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(assertOk(serializeToJson(undefined))).toBeUndefined();
  });

  it('serializes plain objects', () => {
    const result = assertOk(serializeToJson({ foo: 'bar', count: 42 }));
    expect(JSON.parse(result!)).toEqual({ foo: 'bar', count: 42 });
  });

  it('converts Decimal instances to fixed-point strings', () => {
    const data = { amount: new Decimal('1.23456789'), name: 'test' };
    const result = assertOk(serializeToJson(data));
    const parsed = JSON.parse(result!) as { amount: string };
    expect(parsed.amount).toBe('1.23456789');
    expect(typeof parsed.amount).toBe('string');
  });

  it('converts nested Decimal instances', () => {
    const data = {
      movements: [{ amount: new Decimal('0.001'), fee: new Decimal('0.0001') }],
    };
    const result = assertOk(serializeToJson(data));
    const parsed = JSON.parse(result!) as { movements: { amount: string; fee: string }[] };
    expect(parsed.movements[0]!.amount).toBe('0.001');
    expect(parsed.movements[0]!.fee).toBe('0.0001');
  });

  it('handles Decimal-like objects (duck typing)', () => {
    const decimalLike = { d: [1], e: 0, s: 1, toFixed: () => '1.5' };
    const data = { value: decimalLike };
    const result = assertOk(serializeToJson(data));
    const parsed = JSON.parse(result!) as { value: string };
    expect(parsed.value).toBe('1.5');
  });

  it('returns error for circular references', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const result = serializeToJson(circular);
    expect(result.isErr()).toBe(true);
  });
});

describe('parseWithSchema', () => {
  const TestSchema = z.object({ name: z.string(), value: z.number() });

  it('returns undefined for falsy input', () => {
    expect(assertOk(parseWithSchema(null, TestSchema))).toBeUndefined();
    expect(assertOk(parseWithSchema(undefined, TestSchema))).toBeUndefined();
    expect(assertOk(parseWithSchema('', TestSchema))).toBeUndefined();
  });

  it('parses valid JSON string against schema', () => {
    const result = assertOk(parseWithSchema('{"name":"test","value":42}', TestSchema));
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('parses already-parsed object against schema', () => {
    const result = assertOk(parseWithSchema({ name: 'test', value: 42 }, TestSchema));
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('returns error for schema validation failure', () => {
    const error = assertErr(parseWithSchema('{"name":123}', TestSchema));
    expect(error.message).toContain('Schema validation failed');
  });

  it('returns error for invalid JSON', () => {
    const error = assertErr(parseWithSchema('not json', TestSchema));
    expect(error.message).toContain('Failed to parse JSON');
  });
});

describe('parseJson', () => {
  it('returns undefined for falsy input', () => {
    expect(assertOk(parseJson(null))).toBeUndefined();
    expect(assertOk(parseJson(undefined))).toBeUndefined();
    expect(assertOk(parseJson(''))).toBeUndefined();
  });

  it('parses valid JSON string', () => {
    const result = assertOk(parseJson('{"key":"value"}'));
    expect(result).toEqual({ key: 'value' });
  });

  it('passes through non-string values', () => {
    const obj = { key: 'value' };
    expect(assertOk(parseJson(obj))).toBe(obj);
  });

  it('returns error for invalid JSON', () => {
    const error = assertErr(parseJson('not json'));
    expect(error.message).toContain('Failed to parse JSON');
  });
});

describe('toRawTransaction', () => {
  const validRow = {
    id: 1,
    account_id: 10,
    provider_name: 'blockstream',
    source_address: 'bc1q...',
    transaction_type_hint: null,
    event_id: 'tx-123',
    blockchain_transaction_hash: 'abc123',
    timestamp: 1_700_000_000_000,
    provider_data: '{"raw":"data"}',
    normalized_data: '{"normalized":"data"}',
    processing_status: 'pending' as const,
    processed_at: null,
    created_at: '2025-01-01T00:00:00.000Z',
  };

  it('converts a valid row to RawTransaction', () => {
    const result = assertOk(toRawTransaction(validRow));
    expect(result).toEqual({
      id: 1,
      accountId: 10,
      providerName: 'blockstream',
      sourceAddress: 'bc1q...',
      transactionTypeHint: undefined,
      eventId: 'tx-123',
      blockchainTransactionHash: 'abc123',
      timestamp: 1_700_000_000_000,
      providerData: { raw: 'data' },
      normalizedData: { normalized: 'data' },
      processingStatus: 'pending',
      processedAt: undefined,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
  });

  it('converts processedAt when present', () => {
    const row = { ...validRow, processed_at: '2025-06-01T12:00:00.000Z' };
    const result = assertOk(toRawTransaction(row));
    expect(result.processedAt).toEqual(new Date('2025-06-01T12:00:00.000Z'));
  });

  it('returns error when provider_name is missing', () => {
    const row = { ...validRow, provider_name: '' };
    const error = assertErr(toRawTransaction(row));
    expect(error.message).toContain('provider_name');
  });

  it('handles null optional fields as undefined', () => {
    const row = {
      ...validRow,
      source_address: null,
      blockchain_transaction_hash: null,
      transaction_type_hint: null,
    };
    const result = assertOk(toRawTransaction(row));
    expect(result.sourceAddress).toBeUndefined();
    expect(result.blockchainTransactionHash).toBeUndefined();
    expect(result.transactionTypeHint).toBeUndefined();
  });
});
