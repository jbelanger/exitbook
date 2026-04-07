import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunCliCommandBoundary, mockRunLinksBrowseCommand } = vi.hoisted(() => ({
  mockRunCliCommandBoundary: vi.fn(),
  mockRunLinksBrowseCommand: vi.fn(),
}));

vi.mock('../../../../cli/command.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../cli/command.js')>('../../../../cli/command.js');
  return {
    ...actual,
    runCliCommandBoundary: mockRunCliCommandBoundary,
  };
});

vi.mock('../links-browse-command.js', () => ({
  runLinksBrowseCommand: mockRunLinksBrowseCommand,
}));

import { registerLinksViewCommand } from '../links-view.js';

function createProgram(): Command {
  const program = new Command();
  registerLinksViewCommand(program.command('links'));
  return program;
}

describe('links view command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCliCommandBoundary.mockResolvedValue(undefined);
    mockRunLinksBrowseCommand.mockResolvedValue(undefined);
  });

  it('routes proposal selectors to static detail', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'view', 'resolved-li'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-view',
      rawOptions: {},
      selector: 'resolved-li',
      surfaceSpec: {
        commandId: 'links-view',
        kind: 'static-detail',
      },
    });
  });

  it('keeps view --gaps as a compatibility route to the explorer lens', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'view', '--gaps', '--json'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-view',
      optionOverrides: { gaps: true },
      rawOptions: { gaps: true, json: true },
      selector: undefined,
      surfaceSpec: {
        commandId: 'links-view',
        kind: 'explorer-list',
      },
    });
    expect(mockRunCliCommandBoundary).not.toHaveBeenCalled();
  });

  it('rejects view without a selector when gaps mode is not requested', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'view', '--status', 'suggested'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).not.toHaveBeenCalled();
    expect(mockRunCliCommandBoundary).toHaveBeenCalledOnce();
  });
});
