import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerBlockchainsBrowseOptions, runBlockchainsBrowseCommand } from './blockchains-browse-command.js';

export function registerBlockchainsViewCommand(blockchainsCommand: Command, appRuntime: CliAppRuntime): void {
  registerBlockchainsBrowseOptions(
    blockchainsCommand
      .command('view [selector]')
      .description('Open the blockchains explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook blockchains view                    # Open the full blockchain explorer
  $ exitbook blockchains view ethereum           # Open the explorer focused on one blockchain
  $ exitbook blockchains view --category evm     # Explore EVM blockchains only
  $ exitbook blockchains view --requires-api-key # Explore chains needing API-key setup
  $ exitbook blockchains view --json             # Output JSON

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
      commandId: 'blockchains-view',
      rawOptions,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec('blockchains-view')
        : explorerListSurfaceSpec('blockchains-view'),
    });
  });
}
