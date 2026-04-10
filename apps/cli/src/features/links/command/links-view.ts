import type { Command } from 'commander';

import { staticDetailSurfaceSpec } from '../../../cli/presentation.js';

import { registerLinksBrowseOptions, runLinksBrowseCommand } from './links-browse-command.js';

export function registerLinksViewCommand(linksCommand: Command): void {
  registerLinksBrowseOptions(
    linksCommand
      .command('view <selector>')
      .description('Show static detail for one link proposal')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook links view a1b2c3d4e5
  $ exitbook links view a1b2c3d4e5 --json

Notes:
  - Proposal selectors use the LINK-REF derived from the transfer proposal key.
  - Use "links gaps view <tx-ref>" for transaction gap detail.
  - Use "links explore" when you want the interactive explorer.
`
      )
  ).action(async (selector: string, rawOptions: unknown) => {
    await runLinksBrowseCommand({
      commandId: 'links-view',
      rawOptions,
      selector,
      surfaceSpec: staticDetailSurfaceSpec('links-view'),
    });
  });
}
