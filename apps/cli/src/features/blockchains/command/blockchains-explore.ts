import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerBlockchainsBrowseOptions, runBlockchainsBrowseCommand } from './blockchains-browse-command.js';

export function registerBlockchainsExploreCommand(blockchainsCommand: Command, appRuntime: CliAppRuntime): void {
  registerBlockchainsBrowseOptions(
    blockchainsCommand
      .command('explore [selector]')
      .description('Open the blockchains explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook blockchains explore
  $ exitbook blockchains explore ethereum
  $ exitbook blockchains explore --category evm
  $ exitbook blockchains explore --requires-api-key
  $ exitbook blockchains explore --json

Common Usage:
  - Browse supported blockchains before adding accounts
  - Check which chains still need provider API-key configuration
  - Inspect provider coverage and rate limits for a specific chain
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runBlockchainsBrowseCommand({
      appRuntime,
      blockchainSelector: selector,
      commandId: 'blockchains-explore',
      rawOptions,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec('blockchains-explore')
        : explorerListSurfaceSpec('blockchains-explore'),
    });
  });
}
