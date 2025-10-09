import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../logger-factory.js';
import { configureLogger, getLogger, getLoggerContext, resetLoggerContext, type Spinner } from '../logger-factory.js';
import * as pinoLoggerModule from '../pino-logger.js';

interface MockLogger extends Logger {
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
    vi.spyOn(pinoLoggerModule, 'getLogger').mockReturnValue(mockPinoLogger as Logger);

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
    it('should return unwrapped pino logger when no context is set', () => {
      const logger = getLogger('test');

      logger.info('test message');

      expect(mockPinoLogger.info).toHaveBeenCalledWith('test message');
      expect(mockSpinner.message).not.toHaveBeenCalled();
    });

    it('should return unwrapped logger in json mode', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'json', // JSON mode disables spinner
      });

      const logger = getLogger('test');
      logger.info('test message');

      expect(mockPinoLogger.info).toHaveBeenCalledWith('test message');
      expect(mockSpinner.message).not.toHaveBeenCalled();
    });

    it('should return unwrapped logger when spinner is not set', () => {
      configureLogger({
        mode: 'text',
        // spinner not provided
      });

      const logger = getLogger('test');
      logger.info('test message');

      expect(mockPinoLogger.info).toHaveBeenCalledWith('test message');
      expect(mockSpinner.message).not.toHaveBeenCalled();
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
      it('should route info messages to spinner', () => {
        const logger = getLogger('test');
        logger.info('test info message');

        // Should call pino logger (for files/audit)
        expect(mockPinoLogger.info).toHaveBeenCalledWith('test info message');

        // Should also update spinner
        expect(mockSpinner.message).toHaveBeenCalledWith('test info message');
      });

      it('should handle pino-style info with metadata object', () => {
        const logger = getLogger('test');
        logger.info({ metadata: 'value' }, 'test message');

        // Should call pino logger with both args
        expect(mockPinoLogger.info).toHaveBeenCalledWith({ metadata: 'value' }, 'test message');

        // Should update spinner with message
        expect(mockSpinner.message).toHaveBeenCalledWith('test message');
      });

      it('should not update spinner when message is empty', () => {
        const logger = getLogger('test');
        logger.info({ metadata: 'value' });

        expect(mockPinoLogger.info).toHaveBeenCalled();
        expect(mockSpinner.message).not.toHaveBeenCalled();
      });
    });

    describe('warn logging', () => {
      it('should route warn messages to spinner with warning icon', () => {
        const logger = getLogger('test');
        logger.warn('test warning');

        expect(mockPinoLogger.warn).toHaveBeenCalledWith('test warning');
        expect(mockSpinner.message).toHaveBeenCalledWith('⚠️  test warning');
      });

      it('should handle pino-style warn with metadata', () => {
        const logger = getLogger('test');
        logger.warn({ code: 'WARN' }, 'warning message');

        expect(mockPinoLogger.warn).toHaveBeenCalledWith({ code: 'WARN' }, 'warning message');
        expect(mockSpinner.message).toHaveBeenCalledWith('⚠️  warning message');
      });
    });

    describe('error logging', () => {
      it('should route error messages to spinner with error icon', () => {
        const logger = getLogger('test');
        logger.error('test error');

        expect(mockPinoLogger.error).toHaveBeenCalledWith('test error');
        expect(mockSpinner.message).toHaveBeenCalledWith('❌ test error');
      });

      it('should handle pino-style error with error object', () => {
        const logger = getLogger('test');
        const error = new Error('test error');
        logger.error({ error }, 'error message');

        expect(mockPinoLogger.error).toHaveBeenCalledWith({ error }, 'error message');
        expect(mockSpinner.message).toHaveBeenCalledWith('❌ error message');
      });
    });

    describe('debug logging', () => {
      it('should not show debug messages on spinner by default', () => {
        const logger = getLogger('test');
        logger.debug('debug message');

        // Should still log to pino
        expect(mockPinoLogger.debug).toHaveBeenCalledWith('debug message');

        // Should NOT update spinner (verbose is false)
        expect(mockSpinner.message).not.toHaveBeenCalled();
      });

      it('should show debug messages on spinner when verbose is true', () => {
        resetLoggerContext();
        configureLogger({
          spinner: mockSpinner,
          mode: 'text',
          verbose: true, // Enable verbose
        });

        const logger = getLogger('test');
        logger.debug('debug message');

        expect(mockPinoLogger.debug).toHaveBeenCalledWith('debug message');
        expect(mockSpinner.message).toHaveBeenCalledWith('[DEBUG] debug message');
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

        expect(mockPinoLogger.debug).toHaveBeenCalledWith({ data: 'value' }, 'debug message');
        expect(mockSpinner.message).toHaveBeenCalledWith('[DEBUG] debug message');
      });
    });

    describe('child logger', () => {
      it('should wrap child loggers with spinner awareness', () => {
        const logger = getLogger('parent');
        const childLogger = logger.child({ subsystem: 'child' });

        childLogger.info('child message');

        // Child logger should also route to spinner
        expect(mockSpinner.message).toHaveBeenCalledWith('child message');
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

      expect(mockSpinner.message).toHaveBeenCalledTimes(2);
      expect(mockSpinner.message).toHaveBeenNthCalledWith(1, 'Starting import');
      expect(mockSpinner.message).toHaveBeenNthCalledWith(2, 'Importing 100 items');

      // End of command
      resetLoggerContext();

      // Subsequent logs should not use spinner
      vi.clearAllMocks();
      const logger2 = getLogger('import');
      logger2.info('Post-command log');

      expect(mockSpinner.message).not.toHaveBeenCalled();
    });

    it('should handle error path cleanup', () => {
      configureLogger({
        spinner: mockSpinner,
        mode: 'text',
      });

      const logger = getLogger('import');
      logger.error('Import failed');

      expect(mockSpinner.message).toHaveBeenCalledWith('❌ Import failed');

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

      expect(mockSpinner.message).toHaveBeenCalledTimes(2);
      expect(mockSpinner.message).toHaveBeenNthCalledWith(1, 'Importer message');
      expect(mockSpinner.message).toHaveBeenNthCalledWith(2, 'Processor message');
    });
  });
});
