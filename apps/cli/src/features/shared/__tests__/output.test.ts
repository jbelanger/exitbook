import * as p from '@clack/prompts';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitCodes } from '../exit-codes.js';
import { OutputManager } from '../output.js';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  unicodeOr: vi.fn((_primary: string, fallback: string) => fallback),
  log: {
    message: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock logger
// cSpell:ignore exitbook
vi.mock('@exitbook/logger', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('OutputManager', () => {
  let consoleLogSpy: MockInstance<(message?: unknown, ...optionalParams: unknown[]) => void>;
  let consoleErrorSpy: MockInstance<(message?: unknown, ...optionalParams: unknown[]) => void>;
  let processExitSpy: MockInstance<(code?: number | string | null) => never>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    process.env['NODE_ENV'] = 'test';

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      // Mock implementation
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Mock implementation
    });
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should default to text format', () => {
      const output = new OutputManager();
      expect(output.isTextMode()).toBe(true);
      expect(output.isJsonMode()).toBe(false);
    });

    it('should accept json format', () => {
      const output = new OutputManager('json');
      expect(output.isJsonMode()).toBe(true);
      expect(output.isTextMode()).toBe(false);
    });

    it('should accept text format', () => {
      const output = new OutputManager('text');
      expect(output.isTextMode()).toBe(true);
      expect(output.isJsonMode()).toBe(false);
    });
  });

  describe('isJsonMode', () => {
    it('should return true for json format', () => {
      const output = new OutputManager('json');
      expect(output.isJsonMode()).toBe(true);
    });

    it('should return false for text format', () => {
      const output = new OutputManager('text');
      expect(output.isJsonMode()).toBe(false);
    });
  });

  describe('isTextMode', () => {
    it('should return true for text format', () => {
      const output = new OutputManager('text');
      expect(output.isTextMode()).toBe(true);
    });

    it('should return false for json format', () => {
      const output = new OutputManager('json');
      expect(output.isTextMode()).toBe(false);
    });
  });

  describe('success', () => {
    it('should output JSON in json mode', () => {
      const output = new OutputManager('json');

      // Advance time to test duration
      vi.advanceTimersByTime(1000);

      output.json('test-command', { result: 'success' });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const jsonOutput = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as {
        command: string;
        data: { result: string };
        metadata: { duration_ms: number };
        success: boolean;
        timestamp: string;
      };

      expect(jsonOutput).toEqual({
        success: true,
        command: 'test-command',
        timestamp: '2024-01-01T00:00:01.000Z',
        data: { result: 'success' },
        metadata: {
          duration_ms: 1000,
        },
      });
    });

    it('should output text in text mode', () => {
      const output = new OutputManager('text');
      output.json('test-command', { result: 'success' });

      // In text mode, success calls the logger (mocked)
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should include custom metadata', () => {
      const output = new OutputManager('json');

      output.json('test-command', { result: 'success' }, { custom: 'metadata' });

      const jsonOutput = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as {
        metadata?: { custom?: string };
      };
      expect(jsonOutput.metadata).toMatchObject({
        custom: 'metadata',
      });
    });
  });

  describe('error', () => {
    it('should output JSON error in json mode', () => {
      const output = new OutputManager('json');
      const error = new Error('Test error');

      expect(() => output.error('test-command', error, ExitCodes.GENERAL_ERROR)).toThrow('process.exit called');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const jsonOutput = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as {
        command: string;
        error: { code: string; message: string };
        success: boolean;
        timestamp: string;
      };

      expect(jsonOutput).toEqual({
        success: false,
        command: 'test-command',
        timestamp: '2024-01-01T00:00:00.000Z',
        error: {
          code: 'GENERAL_ERROR',
          message: 'Test error',
        },
      });

      expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.GENERAL_ERROR);
    });

    it('should output text error in text mode', () => {
      const output = new OutputManager('text');
      const error = new Error('Test error');

      expect(() => output.error('test-command', error, ExitCodes.INVALID_ARGS)).toThrow('process.exit called');

      expect(p.log.error).toHaveBeenCalled();
      expect(p.note).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.INVALID_ARGS);
    });

    it('should use default exit code if not provided', () => {
      const output = new OutputManager('json');
      const error = new Error('Test error');

      expect(() => output.error('test-command', error)).toThrow('process.exit called');

      expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.GENERAL_ERROR);
    });

    it('should show helpful notes for specific error codes in text mode', () => {
      const output = new OutputManager('text');

      expect(() => output.error('test-command', new Error('Auth error'), ExitCodes.AUTHENTICATION_ERROR)).toThrow(
        'process.exit called'
      );
      expect(p.note).toHaveBeenCalledWith(expect.stringContaining('API credentials'), 'How to fix');

      vi.clearAllMocks();

      expect(() => output.error('test-command', new Error('Not found'), ExitCodes.NOT_FOUND)).toThrow(
        'process.exit called'
      );
      expect(p.note).toHaveBeenCalledWith(expect.stringContaining('not found'), 'Tip');

      vi.clearAllMocks();

      expect(() => output.error('test-command', new Error('Rate limit'), ExitCodes.RATE_LIMIT)).toThrow(
        'process.exit called'
      );
      expect(p.note).toHaveBeenCalledWith(expect.stringContaining('rate limit'), 'How to fix');
    });
  });

  describe('spinner', () => {
    it('should return spinner in text mode', () => {
      const output = new OutputManager('text');
      const spinner = output.spinner();

      expect(spinner).toBeDefined();
      expect(p.spinner).toHaveBeenCalled();
    });

    it('should return undefined in json mode', () => {
      const output = new OutputManager('json');
      const spinner = output.spinner();

      expect(spinner).toBeUndefined();
    });
  });

  describe('intro', () => {
    it('should call p.intro in text mode', () => {
      const output = new OutputManager('text');
      output.intro('Test Message');

      expect(p.intro).toHaveBeenCalled();
    });

    it('should not call p.intro in json mode', () => {
      const output = new OutputManager('json');
      output.intro('Test Message');

      expect(p.intro).not.toHaveBeenCalled();
    });
  });

  describe('outro', () => {
    it('should display custom outro in text mode', () => {
      const output = new OutputManager('text');
      output.outro('Test Message');

      expect(p.outro).toHaveBeenCalledWith(expect.stringContaining('Test Message'));
    });

    it('should not display outro in json mode', () => {
      const output = new OutputManager('json');
      output.outro('Test Message');

      expect(p.outro).not.toHaveBeenCalled();
    });
  });

  describe('note', () => {
    it('should call p.note in text mode', () => {
      const output = new OutputManager('text');
      output.note('Test message', 'Test title');

      expect(p.note).toHaveBeenCalledWith('Test message', 'Test title');
    });

    it('should not call p.note in json mode', () => {
      const output = new OutputManager('json');
      output.note('Test message', 'Test title');

      expect(p.note).not.toHaveBeenCalled();
    });
  });

  describe('log', () => {
    it('should call p.log.message in text mode', () => {
      const output = new OutputManager('text');
      output.log('Test message');

      expect(p.log.message).toHaveBeenCalledWith('Test message', { spacing: 0 });
    });

    it('should not call p.log.message in json mode', () => {
      const output = new OutputManager('json');
      output.log('Test message');

      expect(p.log.message).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('should call p.log.warn in text mode', () => {
      const output = new OutputManager('text');
      output.warn('Warning message');

      expect(p.log.warn).toHaveBeenCalled();
    });

    it('should log to stderr in json mode', () => {
      const output = new OutputManager('json');
      output.warn('Warning message');

      expect(p.log.warn).not.toHaveBeenCalled();
      // Logger is mocked, so we can't verify the actual call
    });
  });
});
