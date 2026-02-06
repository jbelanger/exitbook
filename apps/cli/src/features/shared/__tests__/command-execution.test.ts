import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { unwrapResult } from '../command-execution.js';

describe('command-execution', () => {
  describe('unwrapResult', () => {
    it('should return value for successful Result', () => {
      const result = ok('success value');
      expect(unwrapResult(result)).toBe('success value');
    });

    it('should throw error for failed Result', () => {
      const error = new Error('Test error');
      const result = err(error);
      expect(() => unwrapResult(result)).toThrow(error);
    });

    it('should work with various value types', () => {
      expect(unwrapResult(ok(123))).toBe(123);
      expect(unwrapResult(ok({ key: 'value' }))).toEqual({ key: 'value' });
      expect(unwrapResult(ok(['array', 'items']))).toEqual(['array', 'items']);
      expect(unwrapResult(ok(undefined))).toBe(undefined);
    });
  });
});
