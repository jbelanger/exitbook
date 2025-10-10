import type { KyselyDB } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { CommandHandler } from '../command-execution.ts';
import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../command-execution.ts';
import type { OutputManager } from '../output.ts';

// Mock dependencies
vi.mock('@exitbook/data', () => ({
  closeDatabase: vi.fn(),
  initializeDatabase: vi.fn(),
}));

vi.mock('../prompts.ts', () => ({
  handleCancellation: vi.fn(),
  promptConfirm: vi.fn(),
}));

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
      // eslint-disable-next-line unicorn/no-useless-undefined -- explicit undefined is returned
      expect(unwrapResult(ok(undefined))).toBe(undefined);
    });
  });

  describe('withDatabaseAndHandler', () => {
    let mockDatabase: KyselyDB;
    let mockHandler: CommandHandler<string, string>;
    let MockHandlerClass: new (db: KyselyDB) => CommandHandler<string, string>;
    let initializeDatabase: Mock;
    let closeDatabase: Mock;

    beforeEach(async () => {
      vi.clearAllMocks();

      // Mock database
      mockDatabase = {} as KyselyDB;

      // Mock handler
      mockHandler = {
        destroy: vi.fn(),
        execute: vi.fn() as (this: void, params: string) => Promise<import('neverthrow').Result<string, Error>>,
      };

      // Mock handler class constructor
      MockHandlerClass = vi.fn().mockImplementation(() => mockHandler);

      // Mock database functions
      const dataModule = await import('@exitbook/data');
      initializeDatabase = vi.mocked(dataModule.initializeDatabase) as Mock;
      closeDatabase = vi.mocked(dataModule.closeDatabase) as Mock;

      initializeDatabase.mockResolvedValue(mockDatabase);
      closeDatabase.mockResolvedValue(void 0);
    });

    it('should initialize database with clearDb option', async () => {
      (mockHandler.execute as Mock).mockResolvedValue(ok('result'));

      await withDatabaseAndHandler({ clearDb: true }, MockHandlerClass, 'params');

      expect(initializeDatabase).toHaveBeenCalledWith(true);
    });

    it('should create handler with database and execute with params', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is returned
      const executeMock = mockHandler.execute.bind(undefined) as Mock;
      executeMock.mockResolvedValue(ok('result'));

      await withDatabaseAndHandler({ clearDb: false }, MockHandlerClass, 'test-params');

      expect(MockHandlerClass).toHaveBeenCalledWith(mockDatabase);
      expect(executeMock).toHaveBeenCalledWith('test-params');
    });

    it('should return successful result and cleanup resources', async () => {
      const expectedResult = ok('success');
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is returned
      const executeMock = mockHandler.execute.bind(undefined) as Mock;
      const destroyMock = mockHandler.destroy.bind(mockHandler) as Mock;
      executeMock.mockResolvedValue(expectedResult);

      const result = await withDatabaseAndHandler({ clearDb: false }, MockHandlerClass, 'params');

      expect(result).toBe(expectedResult);
      expect(destroyMock).toHaveBeenCalled();
      expect(closeDatabase).toHaveBeenCalledWith(mockDatabase);
    });

    it('should return error result and cleanup resources', async () => {
      const expectedError = err(new Error('Handler error'));
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is returned
      const executeMock = mockHandler.execute.bind(undefined) as Mock;
      const destroyMock = mockHandler.destroy.bind(mockHandler) as Mock;
      executeMock.mockResolvedValue(expectedError);

      const result = await withDatabaseAndHandler({ clearDb: false }, MockHandlerClass, 'params');

      expect(result).toBe(expectedError);
      expect(destroyMock).toHaveBeenCalled();
      expect(closeDatabase).toHaveBeenCalledWith(mockDatabase);
    });

    it('should cleanup resources when handler throws', async () => {
      const error = new Error('Handler threw');
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is returned
      const executeMock = mockHandler.execute.bind(undefined) as Mock;
      const destroyMock = mockHandler.destroy.bind(mockHandler) as Mock;
      executeMock.mockRejectedValue(error);

      await expect(withDatabaseAndHandler({ clearDb: false }, MockHandlerClass, 'params')).rejects.toThrow(error);

      expect(destroyMock).toHaveBeenCalled();
      expect(closeDatabase).toHaveBeenCalledWith(mockDatabase);
    });

    it('should cleanup resources in correct order on success', async () => {
      const callOrder: string[] = [];
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is returned
      const executeMock = mockHandler.execute.bind(undefined) as Mock;
      const destroyMock = mockHandler.destroy.bind(mockHandler) as Mock;

      executeMock.mockResolvedValue(ok('result'));
      destroyMock.mockImplementation(() => {
        callOrder.push('destroy');
      });
      closeDatabase.mockImplementation(() => {
        callOrder.push('closeDatabase');
        return Promise.resolve(void 0);
      });

      await withDatabaseAndHandler({ clearDb: false }, MockHandlerClass, 'params');

      expect(callOrder).toEqual(['destroy', 'closeDatabase']);
    });

    it('should cleanup resources in correct order on error', async () => {
      const callOrder: string[] = [];
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is returned
      const executeMock = mockHandler.execute.bind(undefined) as Mock;
      const destroyMock = mockHandler.destroy.bind(mockHandler) as Mock;

      executeMock.mockRejectedValue(new Error('Test error'));
      destroyMock.mockImplementation(() => {
        callOrder.push('destroy');
      });
      closeDatabase.mockImplementation(() => {
        callOrder.push('closeDatabase');
        return Promise.resolve(void 0);
      });

      await expect(withDatabaseAndHandler({ clearDb: false }, MockHandlerClass, 'params')).rejects.toThrow();

      expect(callOrder).toEqual(['destroy', 'closeDatabase']);
    });
  });

  describe('resolveCommandParams', () => {
    let mockOutput: Pick<OutputManager, 'intro'>;
    let promptConfirm: Mock;
    let handleCancellation: Mock;

    beforeEach(async () => {
      vi.clearAllMocks();

      // Mock output
      mockOutput = {
        intro: vi.fn(),
      };

      // Mock prompts
      const promptsModule = await import('../prompts.ts');
      promptConfirm = vi.mocked(promptsModule.promptConfirm) as Mock;
      handleCancellation = vi.mocked(promptsModule.handleCancellation) as Mock;
    });

    describe('interactive mode', () => {
      it('should show intro, prompt for params, and confirm', async () => {
        const mockPromptFn = vi.fn().mockResolvedValue({ param: 'value' });
        promptConfirm.mockResolvedValue(true);

        const result = await resolveCommandParams<{ param: string }>({
          buildFromFlags: vi.fn(),
          cancelMessage: 'Test cancelled',
          commandName: 'test',
          confirmMessage: 'Proceed?',
          isInteractive: true,
          output: mockOutput as OutputManager,
          promptFn: mockPromptFn,
        });

        expect(mockOutput.intro).toHaveBeenCalledWith('exitbook test');
        expect(mockPromptFn).toHaveBeenCalled();
        expect(promptConfirm).toHaveBeenCalledWith('Proceed?', true);
        expect(result).toEqual({ param: 'value' });
      });

      it('should handle cancellation when user declines confirmation', async () => {
        const mockPromptFn = vi.fn().mockResolvedValue({ param: 'value' });
        promptConfirm.mockResolvedValue(false);

        await resolveCommandParams({
          buildFromFlags: vi.fn(),
          cancelMessage: 'Operation cancelled',
          commandName: 'test',
          confirmMessage: 'Start?',
          isInteractive: true,
          output: mockOutput as OutputManager,
          promptFn: mockPromptFn,
        });

        expect(handleCancellation).toHaveBeenCalledWith('Operation cancelled');
      });

      it('should pass through various param types from prompt', async () => {
        const complexParams = {
          nested: { data: 'value' },
          numbers: [1, 2, 3],
          string: 'test',
        };
        const mockPromptFn = vi.fn().mockResolvedValue(complexParams);
        promptConfirm.mockResolvedValue(true);

        const result = await resolveCommandParams<{ param: string }>({
          buildFromFlags: vi.fn(),
          cancelMessage: 'Cancelled',
          commandName: 'test',
          confirmMessage: 'Start?',
          isInteractive: true,
          output: mockOutput as OutputManager,
          promptFn: mockPromptFn,
        });

        expect(result).toEqual(complexParams);
      });
    });

    describe('flag mode', () => {
      it('should call buildFromFlags and skip prompts', async () => {
        const mockBuildFromFlags = vi.fn().mockReturnValue({ flag: 'value' });
        const mockPromptFn = vi.fn();

        const result = await resolveCommandParams<{ param: string }>({
          buildFromFlags: mockBuildFromFlags,
          cancelMessage: 'Cancelled',
          commandName: 'test',
          confirmMessage: 'Start?',
          isInteractive: false,
          output: mockOutput as OutputManager,
          promptFn: mockPromptFn,
        });

        expect(mockBuildFromFlags).toHaveBeenCalled();
        expect(mockPromptFn).not.toHaveBeenCalled();
        expect(promptConfirm).not.toHaveBeenCalled();
        expect(mockOutput.intro).not.toHaveBeenCalled();
        expect(result).toEqual({ flag: 'value' });
      });

      it('should propagate errors from buildFromFlags', async () => {
        const error = new Error('Invalid flags');
        const mockBuildFromFlags = vi.fn().mockImplementation(() => {
          throw error;
        });

        await expect(
          resolveCommandParams({
            buildFromFlags: mockBuildFromFlags,
            cancelMessage: 'Cancelled',
            commandName: 'test',
            confirmMessage: 'Start?',
            isInteractive: false,
            output: mockOutput as OutputManager,
            promptFn: vi.fn(),
          })
        ).rejects.toThrow(error);
      });

      it('should work with various command names', async () => {
        const mockBuildFromFlags = vi.fn().mockReturnValue({ data: 'test' });

        await resolveCommandParams({
          buildFromFlags: mockBuildFromFlags,
          cancelMessage: 'Cancelled',
          commandName: 'import',
          confirmMessage: 'Start?',
          isInteractive: false,
          output: mockOutput as OutputManager,
          promptFn: vi.fn(),
        });

        await resolveCommandParams({
          buildFromFlags: mockBuildFromFlags,
          cancelMessage: 'Cancelled',
          commandName: 'export',
          confirmMessage: 'Start?',
          isInteractive: false,
          output: mockOutput as OutputManager,
          promptFn: vi.fn(),
        });

        expect(mockBuildFromFlags).toHaveBeenCalledTimes(2);
      });
    });
  });
});
