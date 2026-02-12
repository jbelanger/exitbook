/* eslint-disable @typescript-eslint/no-empty-function -- acceptable in tests */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BufferedSink } from '../buffered-sink.js';
import { flushLoggers, getLogger, initLogger, type LogEntry, type Sink } from '../logger.js';
import { ConsoleSink } from '../sinks/console.js';

describe('Logger', () => {
  beforeEach(() => {
    initLogger({ sinks: [] });
  });

  it('should be silent by default when not initialized', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = getLogger('test');

    logger.info('test message');
    logger.debug('debug message');
    logger.error('error message');

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should log to sink when initialized', () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'info', sinks: [mockSink] });
    const logger = getLogger('test-category');

    logger.info('test message');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('info');
    expect(entries[0]?.category).toBe('test-category');
    expect(entries[0]?.msg).toBe('test message');
  });

  it('should respect log levels', () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'warn', sinks: [mockSink] });
    const logger = getLogger('test');

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(entries).toHaveLength(2);
    expect(entries[0]?.level).toBe('warn');
    expect(entries[1]?.level).toBe('error');
  });

  it('should handle context objects', () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'info', sinks: [mockSink] });
    const logger = getLogger('test');

    logger.info({ userId: 123, action: 'login' }, 'user logged in');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe('user logged in');
    expect(entries[0]?.context).toEqual({ userId: 123, action: 'login' });
  });

  it('should serialize Error objects in context', () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'info', sinks: [mockSink] });
    const logger = getLogger('test');

    const error = new Error('test error');
    logger.error({ error }, 'operation failed');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.context?.['error']).toMatchObject({
      name: 'Error',
      message: 'test error',
      stack: expect.stringContaining('Error: test error') as string,
    });
  });

  it('should handle circular references in context', () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'info', sinks: [mockSink] });
    const logger = getLogger('test');

    const obj: Record<string, unknown> = { name: 'test' };
    obj['self'] = obj;

    logger.info({ data: obj }, 'circular reference test');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.context?.['data']).toEqual({ name: 'test', self: '[Circular]' });
  });
});

describe('ConsoleSink', () => {
  it('should format log entries correctly', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sink = new ConsoleSink({ color: false });

    sink.write({
      level: 'info',
      category: 'test',
      timestamp: new Date('2024-01-01T12:00:00Z'),
      msg: 'test message',
    });
    sink.flush();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('INFO'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[test]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test message'));
    consoleSpy.mockRestore();
  });

  it('should route error/warn to console.error/warn', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = new ConsoleSink({ color: false });

    sink.write({
      level: 'error',
      category: 'test',
      timestamp: new Date(),
      msg: 'error message',
    });
    sink.write({
      level: 'warn',
      category: 'test',
      timestamp: new Date(),
      msg: 'warn message',
    });
    sink.flush();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('error message'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('warn message'));
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('should format context as key=value pairs', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sink = new ConsoleSink({ color: false });

    sink.write({
      level: 'info',
      category: 'test',
      timestamp: new Date(),
      msg: 'test message',
      context: { userId: 123, action: 'login' },
    });
    sink.flush();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('userId=123'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('action="login"'));
    consoleSpy.mockRestore();
  });
});

describe('Advanced Logger Features', () => {
  beforeEach(() => {
    // Reset logger state before each test
    initLogger({ level: 'info', sinks: [] });
  });

  it('should serialize BigInt in context', () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'info', sinks: [mockSink] });
    const logger = getLogger('test');

    logger.info({ amount: BigInt('9007199254740991') }, 'big number');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.context?.['amount']).toBe('9007199254740991');
  });

  it('should handle multiple sinks', () => {
    const entries1: LogEntry[] = [];
    const entries2: LogEntry[] = [];
    const sink1: Sink = {
      write: (entry: LogEntry) => entries1.push(entry),
      flush: () => {},
    };
    const sink2: Sink = {
      write: (entry: LogEntry) => entries2.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'info', sinks: [sink1, sink2] });
    const logger = getLogger('test');

    logger.info('test message');

    expect(entries1).toHaveLength(1);
    expect(entries2).toHaveLength(1);
    expect(entries1[0]?.msg).toBe('test message');
    expect(entries2[0]?.msg).toBe('test message');
  });

  it('should call flush on all sinks', () => {
    const flush1 = vi.fn();
    const flush2 = vi.fn();
    const sink1: Sink = { write: () => {}, flush: flush1 };
    const sink2: Sink = { write: () => {}, flush: flush2 };

    initLogger({ level: 'info', sinks: [sink1, sink2] });

    flushLoggers();

    expect(flush1).toHaveBeenCalledOnce();
    expect(flush2).toHaveBeenCalledOnce();
  });

  it('should clear logger cache on re-initialization', () => {
    const entries1: LogEntry[] = [];
    const entries2: LogEntry[] = [];
    const sink1: Sink = {
      write: (entry: LogEntry) => entries1.push(entry),
      flush: () => {},
    };
    const sink2: Sink = {
      write: (entry: LogEntry) => entries2.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'info', sinks: [sink1] });
    const logger1 = getLogger('test');
    logger1.info('message 1');

    initLogger({ level: 'info', sinks: [sink2] });
    const logger2 = getLogger('test'); // Get new logger after re-init
    logger2.info('message 2');

    expect(entries1).toHaveLength(1);
    expect(entries2).toHaveLength(1);
    expect(logger1).not.toBe(logger2); // Cache was cleared, so different instance
  });

  it('should cache loggers by category', () => {
    const logger1 = getLogger('test');
    const logger2 = getLogger('test');
    const logger3 = getLogger('other');

    expect(logger1).toBe(logger2);
    expect(logger1).not.toBe(logger3);
  });

  it('should support all log levels', () => {
    const entries: LogEntry[] = [];
    const mockSink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    initLogger({ level: 'trace', sinks: [mockSink] });
    const logger = getLogger('test');

    logger.trace('trace message');
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.level)).toEqual(['trace', 'debug', 'info', 'warn', 'error']);
  });
});

describe('BufferedSink', () => {
  class TestBufferedSink extends BufferedSink {
    public entries: LogEntry[] = [];

    protected writeEntry(entry: LogEntry): void {
      this.entries.push(entry);
    }
  }

  it('should buffer entries and flush asynchronously', async () => {
    const sink = new TestBufferedSink();

    sink.write({
      level: 'info',
      category: 'test',
      timestamp: new Date(),
      msg: 'message 1',
    });

    // Entry should be buffered, not yet written
    expect(sink.entries).toHaveLength(0);

    // Wait for async flush
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]?.msg).toBe('message 1');
  });

  it('should flush synchronously when flush() is called', () => {
    const sink = new TestBufferedSink();

    sink.write({
      level: 'info',
      category: 'test',
      timestamp: new Date(),
      msg: 'message 1',
    });

    expect(sink.entries).toHaveLength(0);

    sink.flush();

    expect(sink.entries).toHaveLength(1);
  });

  it('should drop oldest entries when buffer overflows', () => {
    const sink = new TestBufferedSink({ maxBuffer: 3 });

    for (let i = 1; i <= 5; i++) {
      sink.write({
        level: 'info',
        category: 'test',
        timestamp: new Date(),
        msg: `message ${i}`,
      });
    }

    sink.flush();

    // Should have 3 messages + 1 dropped warning
    expect(sink.entries).toHaveLength(4);
    expect(sink.entries[0]?.msg).toContain('Dropped 2 log entries');
    expect(sink.entries[1]?.msg).toBe('message 3');
    expect(sink.entries[2]?.msg).toBe('message 4');
    expect(sink.entries[3]?.msg).toBe('message 5');
  });

  it('should batch multiple entries in single flush', () => {
    const sink = new TestBufferedSink();

    sink.write({ level: 'info', category: 'test', timestamp: new Date(), msg: 'message 1' });
    sink.write({ level: 'info', category: 'test', timestamp: new Date(), msg: 'message 2' });
    sink.write({ level: 'info', category: 'test', timestamp: new Date(), msg: 'message 3' });

    expect(sink.entries).toHaveLength(0);

    sink.flush();

    expect(sink.entries).toHaveLength(3);
  });
});

describe('Logger initialization order', () => {
  it('should allow loggers created before initLogger to work after init', () => {
    const entries: LogEntry[] = [];
    const mockSink: Sink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    // Create logger BEFORE initLogger (simulates module-level logger creation)
    const logger = getLogger('early-logger');

    // Logger should be silent before init
    logger.info('before init');
    expect(entries).toHaveLength(0);

    // Initialize logger
    initLogger({ level: 'info', sinks: [mockSink] });

    // Logger should now work with the initialized config
    logger.info('after init');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe('after init');
  });

  it('should respect log level changes after re-initialization', () => {
    const entries: LogEntry[] = [];
    const mockSink: Sink = {
      write: (entry: LogEntry) => entries.push(entry),
      flush: () => {},
    };

    const logger = getLogger('test-logger');

    // Initialize with 'warn' level
    initLogger({ level: 'warn', sinks: [mockSink] });

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('warn');

    // Re-initialize with 'debug' level
    initLogger({ level: 'debug', sinks: [mockSink] });

    logger.debug('debug message 2');

    expect(entries).toHaveLength(2);
    expect(entries[1]?.level).toBe('debug');
    expect(entries[1]?.msg).toBe('debug message 2');
  });
});
