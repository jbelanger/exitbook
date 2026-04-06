import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliCommandBoundary } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildBlockchainsBrowseOptionsHelpText,
  executePreparedBlockchainsBrowseCommand,
  prepareBlockchainsBrowseCommand,
  registerBlockchainsBrowseOptions,
} from './blockchains-browse-command.js';
import { registerBlockchainsExploreCommand } from './blockchains-explore.js';
import { registerBlockchainsListCommand } from './blockchains-list.js';
import { registerBlockchainsViewCommand } from './blockchains-view.js';

const BLOCKCHAINS_COMMAND_ID = 'blockchains';

export function registerBlockchainsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const blockchains = program
    .command('blockchains')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse supported blockchains and provider configuration')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook blockchains
  $ exitbook blockchains list --category evm
  $ exitbook blockchains view ethereum
  $ exitbook blockchains explore
  $ exitbook blockchains explore injective
  $ exitbook blockchains explore --requires-api-key
  $ exitbook blockchains --json

Browse Options:
${buildBlockchainsBrowseOptionsHelpText()}

Notes:
  - Use bare "blockchains" or "blockchains list" for a static blockchain list.
  - Use "blockchains view <key>" for a static blockchain detail card.
  - Use "blockchains explore" for the interactive explorer.
  - Use this family to discover supported chains before adding blockchain accounts.
`
    );

  blockchains.action(async (tokens: string[] | undefined) => {
    await runCliCommandBoundary({
      command: BLOCKCHAINS_COMMAND_ID,
      format: detectCliTokenOutputFormat(tokens),
      action: async () =>
        resultDoAsync(async function* () {
          const parsedInvocation = yield* parseCliBrowseRootInvocationResult(tokens, registerBlockchainsBrowseOptions);
          const blockchainSelector = parsedInvocation.selector?.trim();

          if (blockchainSelector) {
            return yield* cliErr(
              new Error(
                `Use "blockchains view ${blockchainSelector}" for static detail or ` +
                  `"blockchains explore ${blockchainSelector}" for the explorer.`
              ),
              ExitCodes.INVALID_ARGS
            );
          }

          const prepared = yield* prepareBlockchainsBrowseCommand({
            appRuntime,
            commandId: BLOCKCHAINS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            surfaceSpec: staticListSurfaceSpec(BLOCKCHAINS_COMMAND_ID),
          });

          return yield* await executePreparedBlockchainsBrowseCommand(prepared, appRuntime);
        }),
    });
  });

  registerBlockchainsListCommand(blockchains, appRuntime);
  registerBlockchainsViewCommand(blockchains, appRuntime);
  registerBlockchainsExploreCommand(blockchains, appRuntime);
}
