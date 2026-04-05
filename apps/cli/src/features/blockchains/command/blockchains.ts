import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliCommandBoundary } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticDetailSurfaceSpec, staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildBlockchainsBrowseOptionsHelpText,
  prepareBlockchainsBrowseCommand,
  executePreparedBlockchainsBrowseCommand,
  registerBlockchainsBrowseOptions,
} from './blockchains-browse-command.js';
import { registerBlockchainsViewCommand } from './blockchains-view.js';

const BLOCKCHAINS_COMMAND_ID = 'blockchains';
const BLOCKCHAINS_LIST_ALIAS = 'list';

export function registerBlockchainsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const blockchains = program
    .command('blockchains')
    .usage('[selector] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse supported blockchains and provider configuration')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook blockchains
  $ exitbook blockchains ethereum
  $ exitbook blockchains view
  $ exitbook blockchains view ethereum
  $ exitbook blockchains view --category evm
  $ exitbook blockchains view --requires-api-key
  $ exitbook blockchains --json

Browse Options:
${buildBlockchainsBrowseOptionsHelpText()}

Notes:
  - Use bare "blockchains" for a static blockchain list.
  - Use "blockchains <key>" for a static blockchain detail card.
  - Use "blockchains view" for the interactive explorer.
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

          if (blockchainSelector?.toLowerCase() === BLOCKCHAINS_LIST_ALIAS) {
            return yield* cliErr(
              new Error('Use bare "blockchains" instead of "blockchains list".'),
              ExitCodes.INVALID_ARGS
            );
          }

          const prepared = yield* prepareBlockchainsBrowseCommand({
            appRuntime,
            blockchainSelector,
            commandId: BLOCKCHAINS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            surfaceSpec: blockchainSelector
              ? staticDetailSurfaceSpec(BLOCKCHAINS_COMMAND_ID)
              : staticListSurfaceSpec(BLOCKCHAINS_COMMAND_ID),
          });

          return yield* await executePreparedBlockchainsBrowseCommand(prepared, appRuntime);
        }),
    });
  });

  registerBlockchainsViewCommand(blockchains, appRuntime);
}
