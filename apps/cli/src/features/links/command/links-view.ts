import type { Command } from 'commander';

import { staticDetailSurfaceSpec } from '../../../cli/presentation.js';

import { runLinksBrowseCommand } from './links-browse-command.js';

export function registerLinksViewCommand(linksCommand: Command): void {
  linksCommand
    .command('view <selector>')
    .description('Show static detail for one link proposal or one link gap')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links view a1b2c3d4e5
  $ exitbook links gaps view txfp123abc
  $ exitbook links view txfp123abc --gaps
  $ exitbook links view a1b2c3d4e5 --json

Notes:
  - Proposal selectors use a short ref derived from the transfer proposal key.
  - Prefer "links gaps view <ref>" for gap detail; "--gaps" remains a compatibility alias.
  - Use "links explore" when you want the interactive explorer.
`
    )
    .option('--status <status>', 'Filter proposals by status (suggested, confirmed, rejected)')
    .option('--gaps', 'Show coverage gaps instead of link proposals')
    .option('--min-confidence <score>', 'Filter proposals by minimum confidence score (0-1)', parseFloat)
    .option('--max-confidence <score>', 'Filter proposals by maximum confidence score (0-1)', parseFloat)
    .option('--verbose', 'Include full transaction details in proposal detail surfaces')
    .option('--json', 'Output JSON format')
    .action(async (selector: string, rawOptions: unknown) => {
      await runLinksBrowseCommand({
        commandId: 'links-view',
        rawOptions,
        selector,
        surfaceSpec: staticDetailSurfaceSpec('links-view'),
      });
    });
}
