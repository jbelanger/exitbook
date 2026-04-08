import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunLinksBrowseCommand } = vi.hoisted(() => ({
  mockRunLinksBrowseCommand: vi.fn(),
}));

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

  it('routes gap selectors to static detail when --gaps is provided', async () => {
    const program = createProgram();

    await program.parseAsync(['links', 'view', 'txfp123abc', '--gaps', '--json'], { from: 'user' });

    expect(mockRunLinksBrowseCommand).toHaveBeenCalledWith({
      commandId: 'links-view',
      rawOptions: { gaps: true, json: true },
      selector: 'txfp123abc',
      surfaceSpec: {
        commandId: 'links-view',
        kind: 'static-detail',
      },
    });
  });
});
