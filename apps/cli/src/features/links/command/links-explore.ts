import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';

import { registerLinksBrowseOptions, runLinksBrowseCommand } from './links-browse-command.js';

export function registerLinksExploreCommand(linksCommand: Command): void {
  registerLinksBrowseOptions(
    linksCommand
      .command('explore [selector]')
      .description('Open the links explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook links explore
  $ exitbook links explore --status suggested
  $ exitbook links explore a1b2c3d4e5

Common Usage:
  - Review suggested transfer proposals before confirming or rejecting them
  - Investigate confirmed or rejected proposals in context
  - Jump directly to one proposal by reference
  - Use "links gaps explore" for unresolved coverage gaps
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runLinksBrowseCommand({
      commandId: 'links-explore',
      rawOptions,
      selector,
      surfaceSpec: selector ? explorerDetailSurfaceSpec('links-explore') : explorerListSurfaceSpec('links-explore'),
    });
  });
}
