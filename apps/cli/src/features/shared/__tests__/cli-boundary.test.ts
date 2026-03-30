import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliFailure, jsonSuccess, silentSuccess } from '../cli-contract.js';
import { ExitCodes } from '../exit-codes.js';

const { mockExitCliFailure, mockOutputSuccess, mockRunCommand, mockRuntime } = vi.hoisted(() => ({
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRuntime: { tag: 'runtime' },
}));

vi.mock('../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../cli-error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

import { runCliCommandBoundary, runCliRuntimeCommand } from '../cli-boundary.js';

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
  it('writes JSON success output without exiting on zero exit code', async () => {
    await runCliCommandBoundary({
      command: 'profiles-add',
      format: 'json',
      action: async () => ok(jsonSuccess({ profileKey: 'default' })),
    });

    expect(mockOutputSuccess).toHaveBeenCalledWith('profiles-add', { profileKey: 'default' }, undefined);
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it('routes failure results through the shared failure exit boundary', async () => {
    await expect(
      runCliCommandBoundary({
        command: 'profiles-switch',
        format: 'text',
        action: async () => err(createCliFailure(new Error('Profile not found'), ExitCodes.NOT_FOUND)),
      })
    ).rejects.toThrow('CLI:profiles-switch:text:Profile not found:4');
  });

  it('maps unexpected throws to the configured boundary exit code', async () => {
    await expect(
      runCliCommandBoundary({
        command: 'profiles-add',
        format: 'text',
        unexpectedErrorExitCode: ExitCodes.CONFIG_ERROR,
        action: async () => {
          throw new Error('Unexpected crash');
        },
      })
    ).rejects.toThrow('CLI:profiles-add:text:Unexpected crash:11');
  });

  it('exits after a successful command with a non-zero completion code', async () => {
    await runCliCommandBoundary({
      command: 'cost-basis-export',
      format: 'text',
      action: async () => ok(silentSuccess(ExitCodes.BLOCKED_PACKAGE)),
    });

    expect(mockProcessExit).toHaveBeenCalledWith(ExitCodes.BLOCKED_PACKAGE);
  });
});

describe('runCliRuntimeCommand', () => {
  it('runs the command body inside runCommand and renders the completion afterward', async () => {
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
});
