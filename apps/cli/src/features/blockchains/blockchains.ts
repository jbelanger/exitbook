// Unified blockchains command for browsing blockchain and provider configuration
// Provides a single namespace for viewing blockchain data

import type { Command } from 'commander';

import { registerBlockchainsViewCommand } from './view-blockchains.js';

/**
 * Register the unified blockchains command with all subcommands.
 *
 * Structure:
 *   blockchains view               - View blockchains with filters
 */
export function registerBlockchainsCommand(program: Command): void {
  const blockchains = program
    .command('blockchains')
    .description('Browse supported blockchains and provider configuration');

  registerBlockchainsViewCommand(blockchains);
}
