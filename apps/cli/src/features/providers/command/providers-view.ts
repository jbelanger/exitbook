import type { Command } from 'commander';

import { staticDetailSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerProvidersBrowseOptions, runProvidersBrowseCommand } from './providers-browse-command.js';

export function registerProvidersViewCommand(providersCommand: Command, appRuntime: CliAppRuntime): void {
  registerProvidersBrowseOptions(
    providersCommand
      .command('view <selector>')
      .description('Show static detail for one provider')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook providers view alchemy
  $ exitbook providers view blockstream.info
  $ exitbook providers view alchemy --json

Common Usage:
  - Inspect one provider before benchmarking it
  - Copy a static provider snapshot into docs, notes, or tickets
  - Pair with "providers explore" when you want navigation and filters instead of one-off detail
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runProvidersBrowseCommand({
      appRuntime,
      providerSelector: selector,
      commandId: 'providers-view',
      rawOptions,
      surfaceSpec: staticDetailSurfaceSpec('providers-view'),
    });
  });
}
