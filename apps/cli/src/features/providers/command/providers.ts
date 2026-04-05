import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliCommandBoundary } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticDetailSurfaceSpec, staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerProvidersBenchmarkCommand } from './providers-benchmark.js';
import {
  buildProvidersBrowseOptionsHelpText,
  executePreparedProvidersBrowseCommand,
  prepareProvidersBrowseCommand,
  registerProvidersBrowseOptions,
} from './providers-browse-command.js';
import { registerProvidersViewCommand } from './providers-view.js';

const PROVIDERS_COMMAND_ID = 'providers';
const PROVIDERS_LIST_ALIAS = 'list';

export function registerProvidersCommand(program: Command, appRuntime: CliAppRuntime): void {
  const providers = program
    .command('providers')
    .usage('[selector] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse blockchain API providers and benchmark live rate limits')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook providers
  $ exitbook providers alchemy
  $ exitbook providers view
  $ exitbook providers view alchemy
  $ exitbook providers view --blockchain ethereum
  $ exitbook providers benchmark --blockchain ethereum --provider alchemy

Browse Options:
${buildProvidersBrowseOptionsHelpText()}

Notes:
  - Use bare "providers" for a static provider list.
  - Use "providers <name>" for a static provider detail card.
  - Use "providers view" for the interactive explorer.
  - "providers benchmark" sends live requests and may consume provider quota.
`
    );

  providers.action(async (tokens: string[] | undefined) => {
    await runCliCommandBoundary({
      command: PROVIDERS_COMMAND_ID,
      format: detectCliTokenOutputFormat(tokens),
      action: async () =>
        resultDoAsync(async function* () {
          const parsedInvocation = yield* parseCliBrowseRootInvocationResult(tokens, registerProvidersBrowseOptions);
          const providerSelector = parsedInvocation.selector?.trim();

          if (providerSelector?.toLowerCase() === PROVIDERS_LIST_ALIAS) {
            return yield* cliErr(
              new Error('Use bare "providers" instead of "providers list".'),
              ExitCodes.INVALID_ARGS
            );
          }

          const prepared = yield* prepareProvidersBrowseCommand({
            appRuntime,
            providerSelector,
            commandId: PROVIDERS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            surfaceSpec: providerSelector
              ? staticDetailSurfaceSpec(PROVIDERS_COMMAND_ID)
              : staticListSurfaceSpec(PROVIDERS_COMMAND_ID),
          });

          return yield* await executePreparedProvidersBrowseCommand(prepared, appRuntime);
        }),
    });
  });

  registerProvidersViewCommand(providers, appRuntime);
  registerProvidersBenchmarkCommand(providers, appRuntime);
}
