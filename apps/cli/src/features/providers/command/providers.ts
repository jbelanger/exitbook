import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliCommandBoundary } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerProvidersBenchmarkCommand } from './providers-benchmark.js';
import {
  buildProvidersBrowseOptionsHelpText,
  executePreparedProvidersBrowseCommand,
  prepareProvidersBrowseCommand,
  registerProvidersBrowseOptions,
} from './providers-browse-command.js';
import { registerProvidersExploreCommand } from './providers-explore.js';
import { registerProvidersListCommand } from './providers-list.js';
import { registerProvidersViewCommand } from './providers-view.js';

const PROVIDERS_COMMAND_ID = 'providers';

export function registerProvidersCommand(program: Command, appRuntime: CliAppRuntime): void {
  const providers = program
    .command('providers')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse blockchain API providers and benchmark live rate limits')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook providers
  $ exitbook providers list --health degraded
  $ exitbook providers view alchemy
  $ exitbook providers explore
  $ exitbook providers explore alchemy
  $ exitbook providers explore --blockchain ethereum
  $ exitbook providers benchmark --blockchain ethereum --provider alchemy

Browse Options:
${buildProvidersBrowseOptionsHelpText()}

Notes:
  - Use bare "providers" or "providers list" for a static provider list.
  - Use "providers view <name>" for a static provider detail card.
  - Use "providers explore" for the interactive explorer.
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

          if (providerSelector) {
            return yield* cliErr(
              new Error(
                `Use "providers view ${providerSelector}" for static detail or ` +
                  `"providers explore ${providerSelector}" for the explorer.`
              ),
              ExitCodes.INVALID_ARGS
            );
          }

          const prepared = yield* prepareProvidersBrowseCommand({
            appRuntime,
            commandId: PROVIDERS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            surfaceSpec: staticListSurfaceSpec(PROVIDERS_COMMAND_ID),
          });

          return yield* await executePreparedProvidersBrowseCommand(prepared, appRuntime);
        }),
    });
  });

  registerProvidersListCommand(providers, appRuntime);
  registerProvidersViewCommand(providers, appRuntime);
  registerProvidersExploreCommand(providers, appRuntime);
  registerProvidersBenchmarkCommand(providers, appRuntime);
}
