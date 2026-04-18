import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecutePreparedLinksGapsBrowseCommand,
  mockExitCliFailure,
  mockPrepareLinksGapsBrowseCommand,
  mockRegisterLinksGapReopenCommand,
  mockRegisterLinksGapResolveCommand,
  mockRegisterLinksGapsResolvedCommand,
  mockRunCommand,
  mockRunLinksGapsBrowseCommand,
} = vi.hoisted(() => ({
  mockExecutePreparedLinksGapsBrowseCommand: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockPrepareLinksGapsBrowseCommand: vi.fn(),
  mockRegisterLinksGapReopenCommand: vi.fn(),
  mockRegisterLinksGapResolveCommand: vi.fn(),
  mockRegisterLinksGapsResolvedCommand: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLinksGapsBrowseCommand: vi.fn(),
}));

vi.mock('../../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../links-gaps-browse-command.js', () => ({
  executePreparedLinksGapsBrowseCommand: mockExecutePreparedLinksGapsBrowseCommand,
  prepareLinksGapsBrowseCommand: mockPrepareLinksGapsBrowseCommand,
  registerLinksGapsBrowseOptions: vi.fn((command: Command) => {
    command.option('--json');
    return command;
  }),
  runLinksGapsBrowseCommand: mockRunLinksGapsBrowseCommand,
}));

vi.mock('../links-gap-resolution-command.js', () => ({
  registerLinksGapReopenCommand: mockRegisterLinksGapReopenCommand,
  registerLinksGapResolveCommand: mockRegisterLinksGapResolveCommand,
}));

vi.mock('../links-gaps-resolved-command.js', () => ({
  registerLinksGapsResolvedCommand: mockRegisterLinksGapsResolvedCommand,
}));

import { registerLinksGapsCommand } from '../links-gaps.js';

function createProgram(): Command {
  const program = new Command();
  const links = program.command('links');
  registerLinksGapsCommand(links);
  return program;
}

describe('links gaps command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(
      async (
        arg1: { tag: string } | ((ctx: { tag: string }) => Promise<void>),
        arg2?: (ctx: { tag: string }) => Promise<void>
      ) => {
        const fn = typeof arg1 === 'function' ? arg1 : arg2;
        if (!fn) {
          throw new Error('expected command runtime callback');
        }
        await fn({ tag: 'command-runtime' });
      }
    );
    mockPrepareLinksGapsBrowseCommand.mockReturnValue(
      ok({
        params: { selector: undefined },
        presentation: { commandId: 'links-gaps', kind: 'static-list', mode: 'static', staticKind: 'list' },
      })
    );
    mockExecutePreparedLinksGapsBrowseCommand.mockResolvedValue(ok({ output: { kind: 'none' } }));
    mockRunLinksGapsBrowseCommand.mockResolvedValue(undefined);
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('registers the resolved gaps subcommand', () => {
    createProgram();

    expect(mockRegisterLinksGapsResolvedCommand).toHaveBeenCalledTimes(1);
  });

  it('routes bare links gaps through the static browse preparation path', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'gaps'], { from: 'user' });

    expect(mockPrepareLinksGapsBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-gaps',
      rawOptions: {},
      selector: undefined,
      surfaceSpec: {
        commandId: 'links-gaps',
        kind: 'static-list',
      },
    });
    expect(mockExecutePreparedLinksGapsBrowseCommand).toHaveBeenCalledOnce();
  });

  it('rejects bare selectors and points callers to gaps view or explore', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['links', 'gaps', 'abc123'], { from: 'user' })).rejects.toThrow(
      'CLI:links-gaps:text:Use "links gaps view abc123" for static detail or "links gaps explore abc123" for the explorer.:2'
    );

    expect(mockPrepareLinksGapsBrowseCommand).not.toHaveBeenCalled();
    expect(mockExecutePreparedLinksGapsBrowseCommand).not.toHaveBeenCalled();
  });

  it('routes gaps view through the static detail surface', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'gaps', 'view', 'txfp123abc', '--json'], { from: 'user' });

    expect(mockRunLinksGapsBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-gaps-view',
      rawOptions: { json: true },
      selector: 'txfp123abc',
      surfaceSpec: {
        commandId: 'links-gaps-view',
        kind: 'static-detail',
      },
    });
  });

  it('routes gaps explore through the explorer detail surface when a selector is provided', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'gaps', 'explore', 'txfp123abc'], { from: 'user' });

    expect(mockRunLinksGapsBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-gaps-explore',
      rawOptions: {},
      selector: 'txfp123abc',
      surfaceSpec: {
        commandId: 'links-gaps-explore',
        kind: 'explorer-detail',
      },
    });
  });
});
