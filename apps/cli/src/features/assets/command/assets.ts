import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticDetailSurfaceSpec, staticListSurfaceSpec } from '../../../cli/presentation.js';

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
import { registerAssetsIncludeCommand } from './assets-include.js';
import { registerAssetsViewCommand } from './assets-view.js';

const ASSETS_COMMAND_ID = 'assets';
const ASSETS_LIST_ALIAS = 'list';

export function registerAssetsCommand(program: Command): void {
  const assets = program
    .command('assets')
    .usage('[selector] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('View assets and manage review or exclusion decisions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets
  $ exitbook assets USDC
  $ exitbook assets blockchain:ethereum:0xa0b8...
  $ exitbook assets view --action-required
  $ exitbook assets confirm --symbol USDC
  $ exitbook assets exclude --asset-id blockchain:ethereum:0xa0b8...
  $ exitbook assets exclusions

Browse Options:
${buildAssetsBrowseOptionsHelpText()}

Notes:
  - Use bare "assets" for static list/detail output.
  - Bare selectors resolve by exact asset ID first, then by unique symbol.
  - Use "assets view" for the interactive review explorer.
  - Use review and exclusion commands to resolve ambiguous or suspicious assets before accounting.
`
    );

  assets.action(async (tokens: string[] | undefined) => {
    await runCliRuntimeCommand({
      command: ASSETS_COMMAND_ID,
      format: detectCliTokenOutputFormat(tokens),
      prepare: async () =>
        resultDoAsync(async function* () {
          const parsedInvocation = yield* parseCliBrowseRootInvocationResult(tokens, registerAssetsBrowseOptions);
          const selector = parsedInvocation.selector?.trim();

          if (selector?.toLowerCase() === ASSETS_LIST_ALIAS) {
            return yield* cliErr(new Error('Use bare "assets" instead of "assets list".'), ExitCodes.INVALID_ARGS);
          }

          const prepared = yield* prepareAssetsBrowseCommand({
            commandId: ASSETS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            selector,
            surfaceSpec: selector
              ? staticDetailSurfaceSpec(ASSETS_COMMAND_ID)
              : staticListSurfaceSpec(ASSETS_COMMAND_ID),
          });

          return prepared;
        }),
      action: async (context) => executePreparedAssetsBrowseCommand(context.runtime, context.prepared),
    });
  });

  registerAssetsViewCommand(assets);
  registerAssetsConfirmCommand(assets);
  registerAssetsClearReviewCommand(assets);
  registerAssetsExcludeCommand(assets);
  registerAssetsIncludeCommand(assets);
  registerAssetsExclusionsCommand(assets);
}
