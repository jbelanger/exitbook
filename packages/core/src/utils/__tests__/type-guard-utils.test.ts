import { describe, expect, it } from 'vitest';

import { isErrorWithMessage, getErrorMessage, wrapError, hasStringProperty } from '../type-guard-utils.ts';

describe('Type Guard Utilities', () => {
  describe('isErrorWithMessage', () => {
    it('should return true for Error instances with messages', () => {
      const error = new Error('Test error');
      expect(isErrorWithMessage(error)).toBe(true);
    });

    it('should return true for Error subclasses', () => {
      const typeError = new TypeError('Type error');
      const rangeError = new RangeError('Range error');
      const syntaxError = new SyntaxError('Syntax error');

      expect(isErrorWithMessage(typeError)).toBe(true);
      expect(isErrorWithMessage(rangeError)).toBe(true);
      expect(isErrorWithMessage(syntaxError)).toBe(true);
    });

    it('should return true for Error with empty message', () => {
      const error = new Error('');
      expect(isErrorWithMessage(error)).toBe(true);
    });

    it('should return false for non-Error objects', () => {
      expect(isErrorWithMessage('error string')).toBe(false);
      expect(isErrorWithMessage(123)).toBe(false);
      expect(isErrorWithMessage(null)).toBe(false);
      expect(isErrorWithMessage(void 0)).toBe(false);
      expect(isErrorWithMessage({})).toBe(false);
      expect(isErrorWithMessage({ message: 'not an error' })).toBe(false);
    });

    it('should return false for objects with message property but not Error instances', () => {
      const fakeError = { message: 'looks like an error', name: 'FakeError' };
      expect(isErrorWithMessage(fakeError)).toBe(false);
    });

    it('should handle Error instances with modified message property', () => {
      const error = new Error('original');
      Object.defineProperty(error, 'message', {
        value: 123,
        writable: true,
      });
      // Still an Error instance, but message is not a string
      expect(isErrorWithMessage(error)).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error instances', () => {
      const error = new Error('Test error message');
      expect(getErrorMessage(error)).toBe('Test error message');
    });

    it('should extract message from Error subclasses', () => {
      const typeError = new TypeError('Type error message');
      expect(getErrorMessage(typeError)).toBe('Type error message');
    });

    it('should return string representation of non-Error values', () => {
      expect(getErrorMessage('string error')).toBe('string error');
      expect(getErrorMessage(123)).toBe('123');
      expect(getErrorMessage(true)).toBe('true');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(void 0)).toBe('undefined');
    });

    it('should use default message when provided for non-Error values', () => {
      expect(getErrorMessage('string error', 'default message')).toBe('default message');
      expect(getErrorMessage(undefined, 'default message')).toBe('default message');
      expect(getErrorMessage(null, 'default message')).toBe('default message');
    });

    it('should not use default message for Error instances', () => {
      const error = new Error('actual error');
      expect(getErrorMessage(error, 'default message')).toBe('actual error');
    });

    it('should handle objects without meaningful toString', () => {
      const obj = { foo: 'bar' };
      const result = getErrorMessage(obj);
      expect(result).toBe('[object Object]');
    });

    it('should handle empty Error messages', () => {
      const error = new Error('');
      expect(getErrorMessage(error)).toBe('');
    });

    it('should handle objects with custom toString', () => {
      const obj = {
        toString: () => 'custom error string',
      };
      expect(getErrorMessage(obj)).toBe('custom error string');
    });
  });

  describe('wrapError', () => {
    it('should wrap Error instances with context', () => {
      const error = new Error('Original error');
      const result = wrapError(error, 'Context');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBe(error);
        expect(result.error.message).toBe('Original error');
      }
    });

    it('should create new Error for non-Error values with context', () => {
      const result = wrapError('string error', 'Failed to process');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('Failed to process: string error');
      }
    });

    it('should handle numeric errors', () => {
      const result = wrapError(404, 'HTTP error');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('HTTP error: 404');
      }
    });

    it('should handle null errors', () => {
      const result = wrapError(null, 'Null error');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Null error: null');
      }
    });

    it('should handle undefined errors', () => {
      const result = wrapError(undefined, 'Undefined error');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Undefined error: undefined');
      }
    });

    it('should preserve Error subclasses', () => {
      const typeError = new TypeError('Type mismatch');
      const result = wrapError(typeError, 'Validation failed');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBe(typeError);
        expect(result.error).toBeInstanceOf(TypeError);
      }
    });

    it('should handle objects with message property', () => {
      const obj = { message: 'object error', code: 500 };
      const result = wrapError(obj, 'Server error');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Server error: [object Object]');
      }
    });

    it('should handle context with special characters', () => {
      const result = wrapError('error', 'Context: with: colons');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Context: with: colons: error');
      }
    });
  });

  describe('hasStringProperty', () => {
    it('should return true for objects with string properties', () => {
      const obj = { name: 'John', age: 30 };
      expect(hasStringProperty(obj, 'name')).toBe(true);
    });

    it('should return false for objects with non-string properties', () => {
      const obj = { name: 'John', age: 30 };
      expect(hasStringProperty(obj, 'age')).toBe(false);
    });

    it('should return false for objects without the property', () => {
      const obj = { name: 'John' };
      expect(hasStringProperty(obj, 'email')).toBe(false);
    });

    it('should return false for null', () => {
      expect(hasStringProperty(null, 'name')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(hasStringProperty(undefined, 'name')).toBe(false);
    });

    it('should return false for primitives', () => {
      expect(hasStringProperty('string', 'length')).toBe(false);
      expect(hasStringProperty(123, 'toString')).toBe(false);
      expect(hasStringProperty(true, 'toString')).toBe(false);
    });

    it('should return false for arrays', () => {
      const arr = ['a', 'b', 'c'];
      expect(hasStringProperty(arr, '0')).toBe(false);
    });

    it('should handle empty strings as property values', () => {
      const obj = { name: '' };
      expect(hasStringProperty(obj, 'name')).toBe(true);
    });

    it('should handle objects with null property values', () => {
      const obj = { name: null };
      expect(hasStringProperty(obj, 'name')).toBe(false);
    });

    it('should handle objects with undefined property values', () => {
      const obj = { name: undefined };
      expect(hasStringProperty(obj, 'name')).toBe(false);
    });

    it('should work with Error objects', () => {
      const error = new Error('test');
      expect(hasStringProperty(error, 'message')).toBe(true);
      expect(hasStringProperty(error, 'name')).toBe(true);
      expect(hasStringProperty(error, 'stack')).toBe(true);
    });

    it('should type guard correctly', () => {
      const obj: unknown = { name: 'John' };

      if (hasStringProperty(obj, 'name')) {
        // TypeScript should know that obj.name is a string
        const name: string = obj.name;
        expect(name).toBe('John');
      }
    });

    it('should handle nested objects', () => {
      const obj = {
        user: {
          name: 'John',
        },
      };
      expect(hasStringProperty(obj, 'user')).toBe(false);
    });

    it('should handle numeric string values', () => {
      const obj = { value: '123' };
      expect(hasStringProperty(obj, 'value')).toBe(true);
    });

    it('should handle special string values', () => {
      const obj = {
        empty: '',
        whitespace: '   ',
        special: 'with\nnewlines\tand\ttabs',
      };
      expect(hasStringProperty(obj, 'empty')).toBe(true);
      expect(hasStringProperty(obj, 'whitespace')).toBe(true);
      expect(hasStringProperty(obj, 'special')).toBe(true);
    });
  });
});
