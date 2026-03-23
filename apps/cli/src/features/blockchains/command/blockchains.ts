import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../composition/runtime.js';

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
    .description('Browse supported blockchains and provider configuration');

  registerBlockchainsViewCommand(blockchains, appRuntime);
}
