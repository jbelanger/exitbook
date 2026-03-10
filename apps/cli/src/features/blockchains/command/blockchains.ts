// Unified blockchains command for browsing blockchain and provider configuration
// Provides a single namespace for viewing blockchain data

import type { AdapterRegistry } from '@exitbook/ingestion';
import type { Command } from 'commander';

import { registerBlockchainsViewCommand } from './blockchains-view.js';

/**
 * Register the unified blockchains command with all subcommands.
 *
 * Structure:
 *   blockchains view               - View blockchains with filters
 */
export function registerBlockchainsCommand(program: Command, registry: AdapterRegistry): void {
  const blockchains = program
    .command('blockchains')
    .description('Browse supported blockchains and provider configuration');

  registerBlockchainsViewCommand(blockchains, registry);
}
