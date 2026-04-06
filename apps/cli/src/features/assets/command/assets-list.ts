import type { Command } from 'commander';

import { staticListSurfaceSpec } from '../../../cli/presentation.js';

import { registerAssetsBrowseOptions, runAssetsBrowseCommand } from './assets-browse-command.js';

export function registerAssetsListCommand(assetsCommand: Command): void {
  registerAssetsBrowseOptions(
    assetsCommand
      .command('list')
      .description('Show a static list of assets')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook assets list
  $ exitbook assets list --action-required
  $ exitbook assets list --needs-review
  $ exitbook assets list --json
`
      )
  ).action(async (rawOptions: unknown) => {
    await runAssetsBrowseCommand({
      commandId: 'assets-list',
      rawOptions,
      surfaceSpec: staticListSurfaceSpec('assets-list'),
    });
  });
}
