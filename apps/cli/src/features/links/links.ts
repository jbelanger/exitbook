// Unified links command with all link management operations
// Provides a single namespace for running linking algorithm, viewing, confirming, and rejecting links

import type { Command } from 'commander';

import { registerLinksConfirmCommand } from './links-confirm.js';
import { registerLinksRejectCommand } from './links-reject.js';
import { registerLinksRunCommand } from './links-run.js';
import { registerLinksViewCommand } from './links-view.js';

/**
 * Register the unified links command with all subcommands.
 *
 * Structure:
 *   links run               - Run the linking algorithm
 *   links view              - View links with filters
 *   links confirm <id>      - Confirm a suggested link
 *   links reject <id>       - Reject a suggested link
 */
export function registerLinksCommand(program: Command): void {
  const links = program.command('links').description('Manage transaction links (run algorithm, view, confirm, reject)');

  // Register subcommands
  registerLinksRunCommand(links);
  registerLinksViewCommand(links);
  registerLinksConfirmCommand(links);
  registerLinksRejectCommand(links);
}
