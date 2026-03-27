import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerBlockchainsViewCommand } from './blockchains-view.js';

/**
 * Register the unified blockchains command with all subcommands.
 *
 * Structure:
 *   blockchains view               - View blockchains with filters
 */
export function registerBlockchainsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const blockchains = program
    .command('blockchains')
    .description('Browse supported blockchains and provider configuration')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook blockchains view
  $ exitbook blockchains view --category evm
  $ exitbook blockchains view --requires-api-key
  $ exitbook blockchains view --json

Notes:
  - Use this command to discover supported chains before adding blockchain accounts.
`
    );

  registerBlockchainsViewCommand(blockchains, appRuntime);
}
