import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';

import {
  buildAssetsBrowseOptionsHelpText,
  registerAssetsBrowseOptions,
  runAssetsBrowseCommand,
} from './assets-browse-command.js';

const ASSETS_EXPLORE_COMMAND_ID = 'assets-explore';

export function registerAssetsExploreCommand(assetsCommand: Command): void {
  registerAssetsBrowseOptions(
    assetsCommand
      .command('explore [selector]')
      .description('Open the assets explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook assets explore
  $ exitbook assets explore USDC
  $ exitbook assets explore blockchain:ethereum:0xa0b8...
  $ exitbook assets explore --action-required
  $ exitbook assets explore --json

Browse Options:
${buildAssetsBrowseOptionsHelpText()}

Notes:
  - Asset selectors resolve by exact asset ID first, then by unique symbol.
  - Use "assets view <selector>" for one-off static detail.
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runAssetsBrowseCommand({
      commandId: ASSETS_EXPLORE_COMMAND_ID,
      rawOptions,
      selector,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec(ASSETS_EXPLORE_COMMAND_ID)
        : explorerListSurfaceSpec(ASSETS_EXPLORE_COMMAND_ID),
    });
  });
}
