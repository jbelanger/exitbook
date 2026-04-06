import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerProvidersBrowseOptions, runProvidersBrowseCommand } from './providers-browse-command.js';

export function registerProvidersExploreCommand(providersCommand: Command, appRuntime: CliAppRuntime): void {
  registerProvidersBrowseOptions(
    providersCommand
      .command('explore [selector]')
      .description('Open the providers explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook providers explore
  $ exitbook providers explore alchemy
  $ exitbook providers explore --blockchain ethereum
  $ exitbook providers explore --health degraded
  $ exitbook providers explore --missing-api-key
  $ exitbook providers explore --json

Common Usage:
  - Browse provider health and performance across blockchains
  - Inspect one provider in context before benchmarking it
  - Find providers missing local API-key configuration
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runProvidersBrowseCommand({
      appRuntime,
      providerSelector: selector,
      commandId: 'providers-explore',
      rawOptions,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec('providers-explore')
        : explorerListSurfaceSpec('providers-explore'),
    });
  });
}
