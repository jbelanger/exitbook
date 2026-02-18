import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseJson, parseWithSchema, serializeToJson } from '../query-utils.js';

describe('query-utils', () => {
  describe('serializeToJson', () => {
    it('serializes Decimal values without throwing', () => {
      const result = serializeToJson({ amount: new Decimal('0.00000001') });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('{"amount":"0.00000001"}');
      }
    });

    it('serializes Decimal-like objects via duck-typing fallback', () => {
      const decimalLike = {
        d: [1],
        e: 0,
        s: 1,
        toFixed: () => '123.45',
      };

      const result = serializeToJson({ value: decimalLike });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('{"value":"123.45"}');
      }
    });

    it('returns error when JSON serialization fails', () => {
      const circular: { self?: unknown } = {};
      circular.self = circular;

      const result = serializeToJson(circular);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to serialize JSON');
      }
    });
  });

  describe('parseWithSchema', () => {
    it('parses and validates valid JSON payloads', () => {
      const schema = z.object({ count: z.number() });

      const result = parseWithSchema('{"count":2}', schema);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({ count: 2 });
      }
    });

    it('returns error when schema validation fails', () => {
      const schema = z.object({ count: z.number() });

      const result = parseWithSchema('{"count":"two"}', schema);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Schema validation failed');
      }
    });
  });

  describe('parseJson', () => {
    it('returns undefined for empty values', () => {
      const result = parseJson(undefined);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('returns error for invalid JSON strings', () => {
      const result = parseJson('{"broken"');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to parse JSON');
      }
    });
  });
});
