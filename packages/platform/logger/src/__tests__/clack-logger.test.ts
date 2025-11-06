import type { MockInstance } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../clack-logger.js';
import { configureLogger, getLogger, getLoggerContext, resetLoggerContext, type Spinner } from '../clack-logger.js';
import * as pinoLoggerModule from '../pino-logger.js';

interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
  bindings: ReturnType<typeof vi.fn>;
}

describe('logger-factory', () => {
  let mockSpinner: Spinner;
  let mockPinoLogger: MockLogger;
  let stderrWriteSpy: MockInstance<(str: string | Uint8Array, ...args: unknown[]) => boolean>;

  beforeEach(() => {
    // Reset logger context before each test
    resetLoggerContext();

    // Create mock pino logger
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(function (this: MockLogger) {
        return this; // Return same mock logger for child calls
      }),
      bindings: vi.fn(() => ({ category: 'test' }) as { category: string }),
    } as unknown as MockLogger;

    mockPinoLogger = mockLogger;

    // Mock the pino getLogger to always return our mock
    vi.spyOn(pinoLoggerModule, 'getLogger').mockReturnValue(mockPinoLogger as unknown as Logger);

    // Mock process.stderr.write to capture direct writes
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Create mock spinner
    mockSpinner = {
      message: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  });

  describe('configureLogger', () => {
    it('should set global logger context', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
        verbose: true,
      });

      const context = getLoggerContext();
      expect(context.spinner).toBe(mockSpinner);
      expect(context.mode).toBe('text');
      expect(context.verbose).toBe(true);
    });

    it('should allow partial context updates', () => {
      configureLogger({ mode: 'json' });

      const context = getLoggerContext();
      expect(context.mode).toBe('json');
      expect(context.spinner).toBeUndefined();
      expect(context.verbose).toBeUndefined();
    });
  });

  describe('resetLoggerContext', () => {
    it('should clear global logger context', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
        verbose: true,
      });

      resetLoggerContext();

      const context = getLoggerContext();
      expect(context.spinner).toBeUndefined();
      expect(context.mode).toBeUndefined();
      expect(context.verbose).toBeUndefined();
    });
  });

  describe('getLoggerContext', () => {
    it('should return empty context by default', () => {
      const context = getLoggerContext();
      expect(context).toEqual({});
    });

    it('should return configured context', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
      });

      const context = getLoggerContext();
      expect(context.spinner).toBe(mockSpinner);
      expect(context.mode).toBe('text');
    });

    it('should return a copy of context (immutable)', () => {
      configureLogger({ mode: 'text' });

      const context1 = getLoggerContext();
      const context2 = getLoggerContext();

      expect(context1).not.toBe(context2); // Different objects
      expect(context1).toEqual(context2); // Same values
    });
  });

  describe('getLogger without spinner context', () => {
    it('should suppress logs when no context is set (progressive disclosure)', () => {
      const logger = getLogger('test');

      logger.info('test message');

      // Logs are suppressed when no spinner is active
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });

    it('should suppress logs in json mode', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'json', // JSON mode disables spinner integration
      });

      const logger = getLogger('test');
      logger.info('test message');

      // Logs are suppressed in JSON mode
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });

    it('should suppress logs when spinner is not set', () => {
      configureLogger({
        mode: 'text',
        // spinner not provided
      });

      const logger = getLogger('test');
      logger.info('test message');

      // Logs are suppressed when spinner is not active
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });
  });

  describe('getLogger with spinner context', () => {
    beforeEach(() => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
        verbose: false,
      });
    });

    describe('info logging', () => {
      it('should write info messages to stderr with clack formatting', () => {
        const logger = getLogger('test');
        logger.info('test info message');

        // Should write to stderr with clack box-drawing format
        // Format: clear line + dimmed box char + message + reset
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[2m│  test info message\x1b[0m\n');
      });

      it('should handle pino-style info with metadata object', () => {
        const logger = getLogger('test');
        logger.info({ metadata: 'value' }, 'test message');

        // Should write to stderr with message only (metadata ignored for display)
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[2m│  test message\x1b[0m\n');
      });

      it('should not write to stderr when message is empty', () => {
        const logger = getLogger('test');
        logger.info({ metadata: 'value' });

        // Should not write when no message provided
        expect(stderrWriteSpy).not.toHaveBeenCalled();
      });
    });

    describe('warn logging', () => {
      it('should write warn messages to stderr with warning icon and yellow color', () => {
        const logger = getLogger('test');
        logger.warn('test warning');

        // Should write with yellow color and warning icon
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[33m│  ⚠️  test warning\x1b[0m\n');
      });

      it('should handle pino-style warn with metadata', () => {
        const logger = getLogger('test');
        logger.warn({ code: 'WARN' }, 'warning message');

        // Should write with yellow color and warning icon
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[33m│  ⚠️  warning message\x1b[0m\n');
      });
    });

    describe('error logging', () => {
      it('should write error messages to stderr with error icon and red color', () => {
        const logger = getLogger('test');
        logger.error('test error');

        // Should write with red color and error icon
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[31m│  ❌ test error\x1b[0m\n');
      });

      it('should handle pino-style error with error object', () => {
        const logger = getLogger('test');
        const error = new Error('test error');
        logger.error({ error }, 'error message');

        // Should write with red color and error icon
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[31m│  ❌ error message\x1b[0m\n');
      });
    });

    describe('debug logging', () => {
      it('should suppress debug messages by default (verbose is false)', () => {
        const logger = getLogger('test');
        logger.debug('debug message');

        // Should NOT write to stderr when verbose is false
        expect(stderrWriteSpy).not.toHaveBeenCalled();
      });

      it('should write debug messages to stderr when verbose is true', () => {
        resetLoggerContext();
        configureLogger({
          spinner: mockSpinner,
          mode: 'text',
          verbose: true, // Enable verbose
        });

        const logger = getLogger('test');
        logger.debug('debug message');

        // Should write with dimmed color and [DEBUG] prefix
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[2m│  [DEBUG] debug message\x1b[0m\n');
      });

      it('should handle pino-style debug with metadata in verbose mode', () => {
        resetLoggerContext();
        configureLogger({
          spinner: mockSpinner,
          mode: 'text',
          verbose: true,
        });

        const logger = getLogger('test');
        logger.debug({ data: 'value' }, 'debug message');

        // Should write with dimmed color and [DEBUG] prefix
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[2m│  [DEBUG] debug message\x1b[0m\n');
      });
    });

    describe('child logger', () => {
      it('should wrap child loggers with clack integration', () => {
        const logger = getLogger('parent');
        const childLogger = logger.child({ subsystem: 'child' });

        childLogger.info('child message');

        // Child logger should also write to stderr with clack formatting
        expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
        expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[2m│  child message\x1b[0m\n');
      });
    });

    describe('other logger methods', () => {
      it('should pass through non-intercepted methods', () => {
        const logger = getLogger('test');

        // Access a property that's not intercepted
        // Type assertion to access mock-specific methods
        const mockLogger = logger as unknown as MockLogger;
        const bindings = mockLogger.bindings() as { category: string };

        expect(bindings).toBeDefined();
        expect(bindings.category).toBe('test');
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle command lifecycle correctly', () => {
      // Start of command
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
      });

      // Logs during command
      const logger = getLogger('import');
      logger.info('Starting import');
      logger.info('Importing 100 items');

      // Should write to stderr 4 times (2 clear + 2 messages)
      expect(stderrWriteSpy).toHaveBeenCalledTimes(4);
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(1, '\r\x1b[K');
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(2, '\x1b[2m│  Starting import\x1b[0m\n');
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(3, '\r\x1b[K');
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(4, '\x1b[2m│  Importing 100 items\x1b[0m\n');

      // End of command
      resetLoggerContext();

      // Subsequent logs should be suppressed (no spinner active)
      stderrWriteSpy.mockClear();
      const logger2 = getLogger('import');
      logger2.info('Post-command log');

      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });

    it('should handle error path cleanup', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
      });

      const logger = getLogger('import');
      logger.error('Import failed');

      // Should write error with red color
      expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1b[K');
      expect(stderrWriteSpy).toHaveBeenCalledWith('\x1b[31m│  ❌ Import failed\x1b[0m\n');

      // Clean up on error
      resetLoggerContext();

      // Verify context is cleared
      const context = getLoggerContext();
      expect(context.spinner).toBeUndefined();
    });

    it('should support multiple logger instances with same context', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
      });

      const logger1 = getLogger('importer');
      const logger2 = getLogger('processor');

      logger1.info('Importer message');
      logger2.info('Processor message');

      // Should write to stderr 4 times (2 clear + 2 messages)
      expect(stderrWriteSpy).toHaveBeenCalledTimes(4);
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(1, '\r\x1b[K');
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(2, '\x1b[2m│  Importer message\x1b[0m\n');
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(3, '\r\x1b[K');
      expect(stderrWriteSpy).toHaveBeenNthCalledWith(4, '\x1b[2m│  Processor message\x1b[0m\n');
    });
  });
});
