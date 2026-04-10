import type { Command } from 'commander';

import { staticListSurfaceSpec } from '../../../cli/presentation.js';

import { registerLinksBrowseOptions, runLinksBrowseCommand } from './links-browse-command.js';

export function registerLinksListCommand(linksCommand: Command): void {
  registerLinksBrowseOptions(
    linksCommand
      .command('list')
      .description('Show a static list of transaction link proposals')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook links list
  $ exitbook links list --status suggested
  $ exitbook links list --json

Notes:
  - Use "links view <link-ref>" for one static detail card.
  - Use "links gaps" for unresolved coverage gaps and gap exceptions.
  - Use "links explore" for the interactive review explorer.
`
      )
  ).action(async (rawOptions: unknown) => {
    await runLinksBrowseCommand({
      commandId: 'links-list',
      rawOptions,
      selector: undefined,
      surfaceSpec: staticListSurfaceSpec('links-list'),
    });
  });
}
