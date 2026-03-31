import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExitCliFailure, mockOutputSuccess, mockRunCommand, mockRuntime } = vi.hoisted(() => ({
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRuntime: { tag: 'runtime' },
}));

vi.mock('../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

import {
  completeCliRuntime,
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliCommandBoundary,
  runCliRuntimeCommand,
} from '../command.js';

const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRunCommand.mockImplementation(async (fn: (runtime: typeof mockRuntime) => Promise<void>) => {
    await fn(mockRuntime);
  });
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('runCliCommandBoundary', () => {
  it('renders a direct action command', async () => {
    await runCliCommandBoundary({
      command: 'providers-view',
      format: 'json',
      action: async () => ok(jsonSuccess({ total: 1 })),
    });

    expect(mockOutputSuccess).toHaveBeenCalledWith('providers-view', { total: 1 }, undefined);
    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

describe('runCliRuntimeCommand', () => {
  it('runs a runtime-backed command without preflight preparation', async () => {
    await runCliRuntimeCommand({
      command: 'profiles-current',
      format: 'json',
      action: async (runtime) => {
        expect(runtime).toBe(mockRuntime);
        return ok(jsonSuccess({ activeProfileKey: 'default' }));
      },
    });

    expect(mockRunCommand).toHaveBeenCalledOnce();
    expect(mockOutputSuccess).toHaveBeenCalledWith('profiles-current', { activeProfileKey: 'default' }, undefined);
  });

  it('short-circuits before runtime when prepared preflight fails', async () => {
    const action = vi.fn();

    await expect(
      runCliRuntimeCommand<{ outputPath: string }>({
        command: 'transactions-export',
        format: 'text',
        prepare: async () => err(createCliFailure(new Error('Invalid export path'), ExitCodes.INVALID_ARGS)),
        action: async ({ runtime, prepared: _prepared }) => {
          action(runtime);
          return ok(jsonSuccess({}));
        },
      })
    ).rejects.toThrow('CLI:transactions-export:text:Invalid export path:2');

    expect(action).not.toHaveBeenCalled();
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('can complete before opening runtime', async () => {
    const action = vi.fn();

    await runCliRuntimeCommand<never>({
      command: 'links-run',
      format: 'json',
      prepare: async () => ok(completeCliRuntime(jsonSuccess({ cancelled: true }))),
      action: async ({ runtime }) => {
        action(runtime);
        return ok(jsonSuccess({}));
      },
    });

    expect(action).not.toHaveBeenCalled();
    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(mockOutputSuccess).toHaveBeenCalledWith('links-run', { cancelled: true }, undefined);
  });
});
