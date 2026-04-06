import type { Command } from 'commander';

import { staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerBlockchainsBrowseOptions, runBlockchainsBrowseCommand } from './blockchains-browse-command.js';

export function registerBlockchainsListCommand(blockchainsCommand: Command, appRuntime: CliAppRuntime): void {
  registerBlockchainsBrowseOptions(
    blockchainsCommand
      .command('list')
      .description('Show a static list of supported blockchains')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook blockchains list
  $ exitbook blockchains list --category evm
  $ exitbook blockchains list --requires-api-key
  $ exitbook blockchains list --json
`
      )
  ).action(async (rawOptions: unknown) => {
    await runBlockchainsBrowseCommand({
      appRuntime,
      commandId: 'blockchains-list',
      rawOptions,
      surfaceSpec: staticListSurfaceSpec('blockchains-list'),
    });
  });
}
