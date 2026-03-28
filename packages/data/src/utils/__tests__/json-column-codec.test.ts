/* eslint-disable unicorn/no-null -- null fixtures are intentional here */
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseJson, parseWithSchema, serializeToJson } from '../json-column-codec.js';

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
    if (result.isErr()) {
      expect(result.error.message).toContain('Failed to serialize JSON');
      expect(result.error.cause).toBeInstanceOf(Error);
    }
  });
});

describe('parseWithSchema', () => {
  const TestSchema = z.object({ name: z.string(), value: z.number() });

  it('returns undefined only for nullish input', () => {
    expect(assertOk(parseWithSchema(null, TestSchema))).toBeUndefined();
    expect(assertOk(parseWithSchema(undefined, TestSchema))).toBeUndefined();
  });

  it('preserves falsy non-null values for schema validation', () => {
    expect(assertOk(parseWithSchema(false, z.boolean()))).toBe(false);
    expect(assertOk(parseWithSchema(0, z.number()))).toBe(0);
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
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('returns error for empty-string JSON instead of treating it as missing', () => {
    const error = assertErr(parseWithSchema('', TestSchema));
    expect(error.message).toContain('Failed to parse JSON');
  });
});

describe('parseJson', () => {
  it('returns undefined only for nullish input', () => {
    expect(assertOk(parseJson(null))).toBeUndefined();
    expect(assertOk(parseJson(undefined))).toBeUndefined();
  });

  it('parses valid JSON string', () => {
    const result = assertOk(parseJson('{"key":"value"}'));
    expect(result).toEqual({ key: 'value' });
  });

  it('passes through non-string values', () => {
    const obj = { key: 'value' };
    expect(assertOk(parseJson(obj))).toBe(obj);
    expect(assertOk(parseJson(false))).toBe(false);
    expect(assertOk(parseJson(0))).toBe(0);
  });

  it('returns error for invalid JSON', () => {
    const error = assertErr(parseJson('not json'));
    expect(error.message).toContain('Failed to parse JSON');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('returns error for empty-string JSON instead of treating it as missing', () => {
    const error = assertErr(parseJson(''));
    expect(error.message).toContain('Failed to parse JSON');
  });
});
