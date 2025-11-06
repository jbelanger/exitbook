// Unified gaps command for data quality inspection
// Provides a single namespace for identifying and auditing data quality issues

import type { Command } from 'commander';

import { registerGapsViewCommand } from './gaps-view.js';

/**
 * Register the unified gaps command with all subcommands.
 *
 * Structure:
 *   gaps view               - View data quality gaps by category (fees, prices, links, validation)
 */
export function registerGapsCommand(program: Command): void {
  const gaps = program
    .command('gaps')
    .description('Inspect data quality gaps and issues (fees, prices, links, validation)');

  // Register subcommands
  registerGapsViewCommand(gaps);
}
