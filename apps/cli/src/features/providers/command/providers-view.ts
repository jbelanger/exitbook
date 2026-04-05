import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerProvidersBrowseOptions, runProvidersBrowseCommand } from './providers-browse-command.js';

export function registerProvidersViewCommand(providersCommand: Command, appRuntime: CliAppRuntime): void {
  registerProvidersBrowseOptions(
    providersCommand
      .command('view [selector]')
      .description('Open the providers explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook providers view
  $ exitbook providers view alchemy
  $ exitbook providers view --blockchain ethereum
  $ exitbook providers view --health degraded
  $ exitbook providers view --missing-api-key
  $ exitbook providers view --json

Common Usage:
  - Browse provider health and performance across blockchains
  - Inspect one provider in detail before benchmarking it
  - Find providers missing local API-key configuration
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runProvidersBrowseCommand({
      appRuntime,
      providerSelector: selector,
      commandId: 'providers-view',
      rawOptions,
      surfaceSpec: selector ? explorerDetailSurfaceSpec('providers-view') : explorerListSurfaceSpec('providers-view'),
    });
  });
}
