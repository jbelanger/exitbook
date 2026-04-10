import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunLinksBrowseCommand } = vi.hoisted(() => ({
  mockRunLinksBrowseCommand: vi.fn(),
}));

vi.mock('../links-browse-command.js', () => ({
  registerLinksBrowseOptions: vi.fn((command: Command) => {
    command.option('--status <status>');
    command.option('--json');
    return command;
  }),
  runLinksBrowseCommand: mockRunLinksBrowseCommand,
}));

import { registerLinksExploreCommand } from '../links-explore.js';

function createProgram(): Command {
  const program = new Command();
  const links = program.command('links');
  registerLinksExploreCommand(links);
  return program;
}

describe('links explore commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunLinksBrowseCommand.mockResolvedValue(undefined);
  });

  it('routes explore lists through the explorer list surface', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'explore', '--status', 'suggested'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-explore',
      rawOptions: { status: 'suggested' },
      selector: undefined,
      surfaceSpec: {
        commandId: 'links-explore',
        kind: 'explorer-list',
      },
    });
  });

  it('routes explore selectors through the explorer detail surface', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'explore', 'a1b2c3d4e5'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-explore',
      rawOptions: {},
      selector: 'a1b2c3d4e5',
      surfaceSpec: {
        commandId: 'links-explore',
        kind: 'explorer-detail',
      },
    });
  });
});
