import { describe, expect, it } from 'vitest';

import { IntegerStringSchema } from '../numbers.js';

describe('numbers', () => {
  describe('IntegerStringSchema', () => {
    it('accepts non-negative integers and converts them to strings', () => {
      expect(IntegerStringSchema.parse(42)).toBe('42');
    });

    it('accepts integer strings', () => {
      expect(IntegerStringSchema.parse('42')).toBe('42');
    });

    it('rejects decimal numbers', () => {
      expect(() => IntegerStringSchema.parse(42.5)).toThrow();
    });

    it('rejects negative integer strings', () => {
      expect(() => IntegerStringSchema.parse('-1')).toThrow('Must be a non-negative integer string');
    });
  });
});
