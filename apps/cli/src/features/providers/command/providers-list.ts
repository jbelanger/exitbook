import type { Command } from 'commander';

import { staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerProvidersBrowseOptions, runProvidersBrowseCommand } from './providers-browse-command.js';

export function registerProvidersListCommand(providersCommand: Command, appRuntime: CliAppRuntime): void {
  registerProvidersBrowseOptions(
    providersCommand
      .command('list')
      .description('Show a static list of providers')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook providers list
  $ exitbook providers list --blockchain ethereum
  $ exitbook providers list --health healthy
  $ exitbook providers list --missing-api-key
  $ exitbook providers list --json
`
      )
  ).action(async (rawOptions: unknown) => {
    await runProvidersBrowseCommand({
      appRuntime,
      commandId: 'providers-list',
      rawOptions,
      surfaceSpec: staticListSurfaceSpec('providers-list'),
    });
  });
}
