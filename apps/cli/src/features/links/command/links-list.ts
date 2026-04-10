import type { Command } from 'commander';

import { staticListSurfaceSpec } from '../../../cli/presentation.js';

import { registerLinksBrowseOptions, runLinksBrowseCommand } from './links-browse-command.js';

export function registerLinksListCommand(linksCommand: Command): void {
  registerLinksBrowseOptions(
    linksCommand
      .command('list')
      .description('Show a static list of transaction link proposals or coverage gaps')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook links list
  $ exitbook links list --status suggested
  $ exitbook links gaps
  $ exitbook links list --gaps
  $ exitbook links list --json

Notes:
  - Prefer "links gaps" for the dedicated gap workflow; "--gaps" remains a compatibility alias here.
  - Use "links view <ref>" or "links gaps view <ref>" for one static detail card.
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
