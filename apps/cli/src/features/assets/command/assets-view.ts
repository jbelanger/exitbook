import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';

import {
  buildAssetsBrowseOptionsHelpText,
  registerAssetsBrowseOptions,
  runAssetsBrowseCommand,
} from './assets-browse-command.js';

const ASSETS_VIEW_COMMAND_ID = 'assets-view';

export function registerAssetsViewCommand(assetsCommand: Command): void {
  registerAssetsBrowseOptions(
    assetsCommand
      .command('view [selector]')
      .description('Open the assets explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook assets view
  $ exitbook assets view USDC
  $ exitbook assets view blockchain:ethereum:0xa0b8...
  $ exitbook assets view --action-required
  $ exitbook assets view --json

Browse Options:
${buildAssetsBrowseOptionsHelpText()}

Notes:
  - Bare selectors resolve by exact asset ID first, then by unique symbol.
  - Use "assets view" for the interactive review explorer.
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runAssetsBrowseCommand({
      commandId: ASSETS_VIEW_COMMAND_ID,
      rawOptions,
      selector,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec(ASSETS_VIEW_COMMAND_ID)
        : explorerListSurfaceSpec(ASSETS_VIEW_COMMAND_ID),
    });
  });
}
