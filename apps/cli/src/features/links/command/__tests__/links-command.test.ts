import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecutePreparedLinksBrowseCommand,
  mockExitCliFailure,
  mockPrepareLinksBrowseCommand,
  mockRegisterLinksConfirmCommand,
  mockRegisterLinksExploreCommand,
  mockRegisterLinksGapsCommand,
  mockRegisterLinksListCommand,
  mockRegisterLinksRejectCommand,
  mockRegisterLinksRunCommand,
  mockRegisterLinksViewCommand,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockExecutePreparedLinksBrowseCommand: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockPrepareLinksBrowseCommand: vi.fn(),
  mockRegisterLinksConfirmCommand: vi.fn(),
  mockRegisterLinksExploreCommand: vi.fn(),
  mockRegisterLinksGapsCommand: vi.fn(),
  mockRegisterLinksListCommand: vi.fn(),
  mockRegisterLinksRejectCommand: vi.fn(),
  mockRegisterLinksRunCommand: vi.fn(),
  mockRegisterLinksViewCommand: vi.fn(),
  mockRunCommand: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../links-browse-command.js', () => ({
  buildLinksBrowseOptionsHelpText: vi.fn(() => '  --json  Output JSON format'),
  executePreparedLinksBrowseCommand: mockExecutePreparedLinksBrowseCommand,
  prepareLinksBrowseCommand: mockPrepareLinksBrowseCommand,
  registerLinksBrowseOptions: vi.fn((command: Command) => {
    command.option('--json');
    return command;
  }),
}));

vi.mock('../links-list.js', () => ({
  registerLinksListCommand: mockRegisterLinksListCommand,
}));

vi.mock('../links-view.js', () => ({
  registerLinksViewCommand: mockRegisterLinksViewCommand,
}));

vi.mock('../links-explore.js', () => ({
  registerLinksExploreCommand: mockRegisterLinksExploreCommand,
  registerLinksGapsCommand: mockRegisterLinksGapsCommand,
}));

vi.mock('../run/links-run.js', () => ({
  registerLinksRunCommand: mockRegisterLinksRunCommand,
}));

vi.mock('../review/links-review-command.js', () => ({
  registerLinksConfirmCommand: mockRegisterLinksConfirmCommand,
  registerLinksRejectCommand: mockRegisterLinksRejectCommand,
}));

import { registerLinksCommand } from '../links.js';

function createProgram(): Command {
  const program = new Command();
  registerLinksCommand(program, { tag: 'app-runtime' } as never);
  return program;
}

describe('links root command', () => {
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
    mockPrepareLinksBrowseCommand.mockReturnValue(
      ok({
        params: { selector: undefined },
        presentation: { commandId: 'links', kind: 'static-list', mode: 'static', staticKind: 'list' },
      })
    );
    mockExecutePreparedLinksBrowseCommand.mockResolvedValue(ok({ output: { kind: 'none' } }));
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('routes bare links through the static browse preparation path', async () => {
    const program = createProgram();

    await program.parseAsync(['links'], { from: 'user' });

    expect(mockPrepareLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links',
      rawOptions: {},
      selector: undefined,
      surfaceSpec: {
        commandId: 'links',
        kind: 'static-list',
      },
    });
    expect(mockExecutePreparedLinksBrowseCommand).toHaveBeenCalledOnce();
  });

  it('rejects bare selectors and points callers to view or explore', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['links', 'abc123'], { from: 'user' })).rejects.toThrow(
      'CLI:links:text:Use "links view abc123" for static detail or "links explore abc123" for the explorer.:2'
    );

    expect(mockPrepareLinksBrowseCommand).not.toHaveBeenCalled();
    expect(mockExecutePreparedLinksBrowseCommand).not.toHaveBeenCalled();
  });
});
