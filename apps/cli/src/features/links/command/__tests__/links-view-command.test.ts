import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunLinksBrowseCommand } = vi.hoisted(() => ({
  mockRunLinksBrowseCommand: vi.fn(),
}));

vi.mock('../links-browse-command.js', () => ({
  registerLinksBrowseOptions: vi.fn((command: Command) => {
    command.option('--json');
    command.option('--verbose');
    return command;
  }),
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
    mockRunLinksBrowseCommand.mockResolvedValue(undefined);
  });

  it('routes proposal selectors to static detail', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'view', 'a1b2c3d4e5'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-view',
      rawOptions: {},
      selector: 'a1b2c3d4e5',
      surfaceSpec: {
        commandId: 'links-view',
        kind: 'static-detail',
      },
    });
  });

  it('passes browse options through proposal detail routes', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'view', 'a1b2c3d4e5', '--json', '--verbose'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-view',
      rawOptions: { json: true, verbose: true },
      selector: 'a1b2c3d4e5',
      surfaceSpec: {
        commandId: 'links-view',
        kind: 'static-detail',
      },
    });
  });
});
