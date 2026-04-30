import type { Command } from 'commander';

import { staticDetailSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildAssetsBrowseOptionsHelpText,
  registerAssetsBrowseOptions,
  runAssetsBrowseCommand,
} from './assets-browse-command.js';

const ASSETS_VIEW_COMMAND_ID = 'assets-view';

export function registerAssetsViewCommand(assetsCommand: Command, appRuntime: CliAppRuntime): void {
  registerAssetsBrowseOptions(
    assetsCommand
      .command('view <selector>')
      .description('Show static detail for one asset')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook assets view USDC
  $ exitbook assets view blockchain:ethereum:0xa0b8...
  $ exitbook assets view USDC --json

Browse Options:
${buildAssetsBrowseOptionsHelpText()}

Notes:
  - Asset selectors resolve by exact asset ID first, then by unique symbol.
  - Use "assets explore" when you want the interactive review explorer.
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runAssetsBrowseCommand({
      appRuntime,
      commandId: ASSETS_VIEW_COMMAND_ID,
      rawOptions,
      selector,
      surfaceSpec: staticDetailSurfaceSpec(ASSETS_VIEW_COMMAND_ID),
    });
  });
}
