import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createErrorResponse, createSuccessResponse, exitCodeToErrorCode } from '../cli-response.js';
import { ExitCodes, type ExitCode } from '../exit-codes.js';

describe('cli-response', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    process.env['NODE_ENV'] = 'test';
  });

  describe('createSuccessResponse', () => {
    it('should create a success response with data', () => {
      const response = createSuccessResponse('test-command', { result: 'success' });

      expect(response).toEqual({
        success: true,
        command: 'test-command',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: { result: 'success' },
      });
    });

    it('should create a success response with metadata', () => {
      const response = createSuccessResponse(
        'test-command',
        { result: 'success' },
        { duration_ms: 100, version: '1.0.0' }
      );

      expect(response).toEqual({
        success: true,
        command: 'test-command',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: { result: 'success' },
        metadata: {
          duration_ms: 100,
          version: '1.0.0',
        },
      });
    });

    it('should create a success response without metadata', () => {
      const response = createSuccessResponse('test-command', { result: 'success' });

      expect(response.metadata).toBeUndefined();
    });

    it('should handle different data types', () => {
      const stringResponse = createSuccessResponse('test', 'string data');
      expect(stringResponse.data).toBe('string data');

      const numberResponse = createSuccessResponse('test', 123);
      expect(numberResponse.data).toBe(123);

      const arrayResponse = createSuccessResponse('test', [1, 2, 3]);
      expect(arrayResponse.data).toEqual([1, 2, 3]);
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response with code and message', () => {
      const error = new Error('Test error');
      const response = createErrorResponse('test-command', error, 'INVALID_ARGS');

      expect(response).toEqual({
        success: false,
        command: 'test-command',
        timestamp: '2024-01-01T00:00:00.000Z',
        error: {
          code: 'INVALID_ARGS',
          message: 'Test error',
        },
      });
    });

    it('should create an error response with details', () => {
      const error = new Error('Test error');
      const details = { field: 'address', reason: 'invalid format' };
      const response = createErrorResponse('test-command', error, 'VALIDATION_ERROR', details);

      expect(response).toEqual({
        success: false,
        command: 'test-command',
        timestamp: '2024-01-01T00:00:00.000Z',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Test error',
          details: { field: 'address', reason: 'invalid format' },
        },
      });
    });

    it('should include stack trace in development mode', () => {
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      const response = createErrorResponse('test-command', error, 'GENERAL_ERROR');

      expect(response.error?.stack).toBe('Error: Test error\n    at test.js:1:1');

      process.env['NODE_ENV'] = originalEnv;
    });

    it('should not include stack trace in production mode', () => {
      const originalEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      const response = createErrorResponse('test-command', error, 'GENERAL_ERROR');

      expect(response.error?.stack).toBeUndefined();

      process.env['NODE_ENV'] = originalEnv;
    });
  });

  describe('exitCodeToErrorCode', () => {
    it('should map exit codes to error code strings', () => {
      expect(exitCodeToErrorCode(ExitCodes.GENERAL_ERROR)).toBe('GENERAL_ERROR');
      expect(exitCodeToErrorCode(ExitCodes.INVALID_ARGS)).toBe('INVALID_ARGS');
      expect(exitCodeToErrorCode(ExitCodes.AUTHENTICATION_ERROR)).toBe('AUTHENTICATION_ERROR');
      expect(exitCodeToErrorCode(ExitCodes.NOT_FOUND)).toBe('NOT_FOUND');
      expect(exitCodeToErrorCode(ExitCodes.RATE_LIMIT)).toBe('RATE_LIMIT');
      expect(exitCodeToErrorCode(ExitCodes.NETWORK_ERROR)).toBe('NETWORK_ERROR');
      expect(exitCodeToErrorCode(ExitCodes.DATABASE_ERROR)).toBe('DATABASE_ERROR');
      expect(exitCodeToErrorCode(ExitCodes.VALIDATION_ERROR)).toBe('VALIDATION_ERROR');
      expect(exitCodeToErrorCode(ExitCodes.CANCELLED)).toBe('CANCELLED');
      expect(exitCodeToErrorCode(ExitCodes.TIMEOUT)).toBe('TIMEOUT');
      expect(exitCodeToErrorCode(ExitCodes.CONFIG_ERROR)).toBe('CONFIG_ERROR');
      expect(exitCodeToErrorCode(ExitCodes.PERMISSION_DENIED)).toBe('PERMISSION_DENIED');
    });

    it('should return UNKNOWN_ERROR for unmapped exit codes', () => {
      expect(exitCodeToErrorCode(999 as ExitCode)).toBe('UNKNOWN_ERROR');
    });

    it('should not map SUCCESS exit code', () => {
      expect(exitCodeToErrorCode(ExitCodes.SUCCESS)).toBe('UNKNOWN_ERROR');
    });
  });
});
