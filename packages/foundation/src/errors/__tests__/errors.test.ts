/* eslint-disable unicorn/no-null -- tests intentionally validate null edge cases. */
import { describe, expect, it } from 'vitest';

import { getErrorMessage, isErrorWithMessage, wrapError } from '../errors.js';

function hasOwnProperty<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

describe('errors', () => {
  describe('isErrorWithMessage', () => {
    it('returns true for Error instances with messages', () => {
      expect(isErrorWithMessage(new Error('Test error'))).toBe(true);
    });

    it('returns false for non-Error values', () => {
      expect(isErrorWithMessage('error string')).toBe(false);
      expect(isErrorWithMessage(123)).toBe(false);
      expect(isErrorWithMessage(null)).toBe(false);
      expect(isErrorWithMessage(void 0)).toBe(false);
      expect(isErrorWithMessage({})).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('extracts message from Error instances', () => {
      expect(getErrorMessage(new Error('Test error message'))).toBe('Test error message');
    });

    it('returns string representation of non-Error values', () => {
      expect(getErrorMessage('string error')).toBe('string error');
      expect(getErrorMessage(123)).toBe('123');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(void 0)).toBe('undefined');
    });

    it('uses default message for non-Error values', () => {
      expect(getErrorMessage('string error', 'default message')).toBe('default message');
      expect(getErrorMessage(undefined, 'default message')).toBe('default message');
    });
  });

  describe('wrapError', () => {
    it('wraps Error instances with context', () => {
      const original = new Error('Original error');
      const result = wrapError(original, 'Context');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Context: Original error');
        expect(result.error.cause).toBe(original);
      }
    });

    it('creates a new Error for non-Error values', () => {
      const result = wrapError('string error', 'Failed to process');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to process: string error');
      }
    });

    it('preserves cause on the wrapped error', () => {
      const result = wrapError({ code: 500 }, 'Server error');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.cause).toBeInstanceOf(Error);
        const cause = result.error.cause;
        if (cause instanceof Error) {
          expect(cause.message).toBe('[object Object]');
        }
      }
    });

    it('returns Err result shape', () => {
      const result = wrapError('boom', 'Context');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(hasOwnProperty(result, 'error')).toBe(true);
      }
    });
  });
});
