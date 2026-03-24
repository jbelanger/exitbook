import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerLinksConfirmCommand } from './links-confirm.js';
import { registerLinksRejectCommand } from './links-reject.js';
import { registerLinksRunCommand } from './links-run.js';
import { registerLinksGapsCommand, registerLinksViewCommand } from './links-view.js';

/**
 * Register the unified links command with all subcommands.
 *
 * Structure:
 *   links run               - Run the linking algorithm
 *   links view              - View links with filters
 *   links gaps              - View link coverage gap analysis
 *   links confirm <id>      - Confirm a suggested link
 *   links reject <id>       - Reject a suggested link
 */
export function registerLinksCommand(program: Command, appRuntime: CliAppRuntime): void {
  const links = program.command('links').description('Manage transaction links (run algorithm, view, confirm, reject)');

  // Register subcommands
  registerLinksRunCommand(links, appRuntime);
  registerLinksViewCommand(links);
  registerLinksGapsCommand(links);
  registerLinksConfirmCommand(links);
  registerLinksRejectCommand(links);
}
