import { Command } from 'commander';
import { ok, err } from 'neverthrow';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { registerImportCommand } from './import.js';

// Mock dependencies
vi.mock('@exitbook/data', () => ({
  initializeDatabase: vi.fn().mockResolvedValue({}),
  closeDatabase: vi.fn().mockResolvedValue(void 0),
}));

vi.mock('../handlers/import-handler.js', () => ({
  ImportHandler: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock('../lib/prompts.js', () => ({
  handleCancellation: vi.fn(),
  isCancelled: vi.fn(),
  promptBlockchain: vi.fn(),
  promptConfirm: vi.fn(),
  promptCsvDirectory: vi.fn(),
  promptExchange: vi.fn(),
  promptImportMethod: vi.fn(),
  promptProvider: vi.fn(),
  promptSourceType: vi.fn(),
  promptWalletAddress: vi.fn(),
}));

// Mock process.exit to prevent tests from exiting
vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
  throw new Error(`process.exit: ${code ?? 'undefined'}`);
});

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {
  /* intentionally empty */
});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {
  /* intentionally empty */
});

describe('import command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    registerImportCommand(program);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('flag mode - blockchain', () => {
    it('should successfully import blockchain data', async () => {
      const { ImportHandler } = await import('../handlers/import-handler.js');
      const { initializeDatabase, closeDatabase } = await import('@exitbook/data');

      const mockExecute = vi.fn().mockResolvedValue(
        ok({
          importSessionId: 123,
          imported: 50,
        })
      );

      (ImportHandler as unknown as Mock).mockImplementation(() => ({
        execute: mockExecute,
        destroy: vi.fn(),
      }));

      const args = ['node', 'test', 'import', '--blockchain', 'bitcoin', '--address', 'bc1qtest'];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      expect(initializeDatabase).toHaveBeenCalledWith(undefined);
      expect(mockExecute).toHaveBeenCalledWith({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
        providerId: undefined,
        csvDir: undefined,
        credentials: undefined,
        shouldProcess: undefined,
      });
      expect(closeDatabase).toHaveBeenCalled();
    });

    it('should process data when --process flag is provided', async () => {
      const { ImportHandler } = await import('../handlers/import-handler.js');

      const mockExecute = vi.fn().mockResolvedValue(
        ok({
          importSessionId: 123,
          imported: 50,
          processed: 50,
          processingErrors: [],
        })
      );

      (ImportHandler as unknown as Mock).mockImplementation(() => ({
        execute: mockExecute,
        destroy: vi.fn(),
      }));

      const args = ['node', 'test', 'import', '--blockchain', 'bitcoin', '--address', 'bc1qtest', '--process'];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldProcess: true,
        })
      );
    });
  });

  describe('flag mode - exchange CSV', () => {
    it('should successfully import exchange CSV data', async () => {
      const { ImportHandler } = await import('../handlers/import-handler.js');

      const mockExecute = vi.fn().mockResolvedValue(
        ok({
          importSessionId: 456,
          imported: 100,
        })
      );

      (ImportHandler as unknown as Mock).mockImplementation(() => ({
        execute: mockExecute,
        destroy: vi.fn(),
      }));

      const args = ['node', 'test', 'import', '--exchange', 'kraken', '--csv-dir', './data/kraken'];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      expect(mockExecute).toHaveBeenCalledWith({
        sourceName: 'kraken',
        sourceType: 'exchange',
        csvDir: './data/kraken',
        address: undefined,
        providerId: undefined,
        credentials: undefined,
        shouldProcess: undefined,
      });
    });
  });

  describe('flag mode - exchange API', () => {
    it('should successfully import exchange API data', async () => {
      const { ImportHandler } = await import('../handlers/import-handler.js');

      const mockExecute = vi.fn().mockResolvedValue(
        ok({
          importSessionId: 789,
          imported: 75,
        })
      );

      (ImportHandler as unknown as Mock).mockImplementation(() => ({
        execute: mockExecute,
        destroy: vi.fn(),
      }));

      const args = [
        'node',
        'test',
        'import',
        '--exchange',
        'kucoin',
        '--api-key',
        'test-key',
        '--api-secret',
        'test-secret',
        '--api-passphrase',
        'test-pass',
      ];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      expect(mockExecute).toHaveBeenCalledWith({
        sourceName: 'kucoin',
        sourceType: 'exchange',
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
          apiPassphrase: 'test-pass',
        },
        csvDir: undefined,
        address: undefined,
        providerId: undefined,
        shouldProcess: undefined,
      });
    });
  });

  describe('JSON mode', () => {
    it('should output JSON on success', async () => {
      const { ImportHandler } = await import('../handlers/import-handler.js');

      const mockExecute = vi.fn().mockResolvedValue(
        ok({
          importSessionId: 123,
          imported: 50,
        })
      );

      (ImportHandler as unknown as Mock).mockImplementation(() => ({
        execute: mockExecute,
        destroy: vi.fn(),
      }));

      const args = ['node', 'test', 'import', '--json', '--blockchain', 'bitcoin', '--address', 'bc1qtest'];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      // Check that JSON was logged
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"success": true'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"command": "import"'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"importSessionId": 123'));
    });

    it('should output JSON error on failure', async () => {
      const { ImportHandler } = await import('../handlers/import-handler.js');

      const mockExecute = vi.fn().mockResolvedValue(err(new Error('Import failed')));

      (ImportHandler as unknown as Mock).mockImplementation(() => ({
        execute: mockExecute,
        destroy: vi.fn(),
      }));

      const args = ['node', 'test', 'import', '--json', '--blockchain', 'bitcoin', '--address', 'bc1qtest'];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      // Check that error JSON was logged to stderr
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"success": false'));
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"command": "import"'));
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"message": "Import failed"'));
    });

    it('should output validation error in JSON format', async () => {
      const args = ['node', 'test', 'import', '--json', '--blockchain', 'bitcoin'];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('"success": false'));
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--address is required'));
    });
  });

  describe('error handling', () => {
    it('should cleanup resources on error', async () => {
      const { ImportHandler } = await import('../handlers/import-handler.js');
      const { closeDatabase } = await import('@exitbook/data');

      const mockDestroy = vi.fn();
      const mockExecute = vi.fn().mockResolvedValue(err(new Error('Database error')));

      (ImportHandler as unknown as Mock).mockImplementation(() => ({
        execute: mockExecute,
        destroy: mockDestroy,
      }));

      const args = ['node', 'test', 'import', '--blockchain', 'bitcoin', '--address', 'bc1qtest'];

      await expect(program.parseAsync(args)).rejects.toThrow(/process\.exit/);

      expect(mockDestroy).toHaveBeenCalled();
      expect(closeDatabase).toHaveBeenCalled();
    });
  });
});
