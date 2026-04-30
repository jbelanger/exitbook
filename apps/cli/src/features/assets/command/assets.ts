import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildAssetsBrowseOptionsHelpText,
  prepareAssetsBrowseCommand,
  executePreparedAssetsBrowseCommand,
  registerAssetsBrowseOptions,
} from './assets-browse-command.js';
import { registerAssetsClearReviewCommand } from './assets-clear-review.js';
import { registerAssetsConfirmCommand } from './assets-confirm.js';
import { registerAssetsExcludeCommand } from './assets-exclude.js';
import { registerAssetsExclusionsCommand } from './assets-exclusions.js';
import { registerAssetsExploreCommand } from './assets-explore.js';
import { registerAssetsIncludeCommand } from './assets-include.js';
import { registerAssetsListCommand } from './assets-list.js';
import { registerAssetsViewCommand } from './assets-view.js';

const ASSETS_COMMAND_ID = 'assets';

export function registerAssetsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const assets = program
    .command('assets')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('View assets and manage review or exclusion decisions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets
  $ exitbook assets list --action-required
  $ exitbook assets view USDC
  $ exitbook assets view blockchain:ethereum:0xa0b8...
  $ exitbook assets explore
  $ exitbook assets explore USDC
  $ exitbook assets explore --action-required
  $ exitbook assets confirm --symbol USDC
  $ exitbook assets exclude --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets exclusions

Browse Options:
${buildAssetsBrowseOptionsHelpText()}

Notes:
  - Use bare "assets" or "assets list" for static asset lists.
  - Use "assets view <selector>" for one static asset detail card.
  - Use "assets explore" for the interactive review explorer.
  - Asset selectors resolve by exact asset ID first, then by unique symbol.
  - Use review and exclusion commands to resolve ambiguous or suspicious assets before accounting.
`
    );

  assets.action(async (tokens: string[] | undefined) => {
    await runCliRuntimeCommand({
      appRuntime,
      command: ASSETS_COMMAND_ID,
      format: detectCliTokenOutputFormat(tokens),
      prepare: async () =>
        resultDoAsync(async function* () {
          const parsedInvocation = yield* parseCliBrowseRootInvocationResult(tokens, registerAssetsBrowseOptions);
          const selector = parsedInvocation.selector?.trim();

          if (selector) {
            return yield* cliErr(
              new Error(
                `Use "assets view ${selector}" for static detail or ` + `"assets explore ${selector}" for the explorer.`
              ),
              ExitCodes.INVALID_ARGS
            );
          }

          const prepared = yield* prepareAssetsBrowseCommand({
            commandId: ASSETS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            surfaceSpec: staticListSurfaceSpec(ASSETS_COMMAND_ID),
          });

          return prepared;
        }),
      action: async (context) => executePreparedAssetsBrowseCommand(context.runtime, context.prepared),
    });
  });

  registerAssetsListCommand(assets, appRuntime);
  registerAssetsViewCommand(assets, appRuntime);
  registerAssetsExploreCommand(assets, appRuntime);
  registerAssetsConfirmCommand(assets, appRuntime);
  registerAssetsClearReviewCommand(assets, appRuntime);
  registerAssetsExcludeCommand(assets, appRuntime);
  registerAssetsIncludeCommand(assets, appRuntime);
  registerAssetsExclusionsCommand(assets, appRuntime);
}
