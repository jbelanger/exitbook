import type { Command } from 'commander';

import { staticDetailSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerBlockchainsBrowseOptions, runBlockchainsBrowseCommand } from './blockchains-browse-command.js';

export function registerBlockchainsViewCommand(blockchainsCommand: Command, appRuntime: CliAppRuntime): void {
  registerBlockchainsBrowseOptions(
    blockchainsCommand
      .command('view <selector>')
      .description('Show static detail for one blockchain')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook blockchains view ethereum
  $ exitbook blockchains view injective
  $ exitbook blockchains view ethereum --json

Common Usage:
  - Inspect provider coverage and API-key readiness for one blockchain
  - Copy a detail snapshot into notes, tickets, or docs
  - Pair with "blockchains explore" when you want navigation instead of a one-off detail card
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runBlockchainsBrowseCommand({
      appRuntime,
      blockchainSelector: selector,
      commandId: 'blockchains-view',
      rawOptions,
      surfaceSpec: staticDetailSurfaceSpec('blockchains-view'),
    });
  });
}
