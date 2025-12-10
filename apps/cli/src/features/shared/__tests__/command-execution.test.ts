import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { resolveCommandParams, unwrapResult } from '../command-execution.js';
import type { OutputManager } from '../output.js';

// Mock dependencies
vi.mock('@exitbook/data', () => ({
  closeDatabase: vi.fn(),
  initializeDatabase: vi.fn(),
}));

vi.mock('../prompts.js', () => ({
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
      expect(unwrapResult(ok(undefined))).toBe(undefined);
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
      const promptsModule = await import('../prompts.js');
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
