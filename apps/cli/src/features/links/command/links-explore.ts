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
  $ exitbook links gaps explore
  $ exitbook links explore --gaps
  $ exitbook links explore a1b2c3d4e5
  $ exitbook links gaps explore txfp123abc

Common Usage:
  - Review suggested transfer proposals before confirming or rejecting them
  - Investigate confirmed or rejected proposals in context
  - Diagnose unresolved link coverage gaps via the dedicated "links gaps" flow
  - Jump directly to one proposal or one gap by fingerprint reference
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
