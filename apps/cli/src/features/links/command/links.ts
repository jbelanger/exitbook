import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerLinksConfirmCommand, registerLinksRejectCommand } from './review/links-review-command.js';
import { registerLinksRunCommand } from './run/links-run.js';
import { registerLinksGapsCommand, registerLinksViewCommand } from './view/links-view.js';

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
  const links = program
    .command('links')
    .description('Manage transaction links (run algorithm, view, confirm, reject)')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links run
  $ exitbook links view --status suggested
  $ exitbook links confirm 123
  $ exitbook links gaps --json

Notes:
  - Run "links run" to generate suggestions before using the review commands.
`
    );

  // Register subcommands
  registerLinksRunCommand(links, appRuntime);
  registerLinksViewCommand(links);
  registerLinksGapsCommand(links);
  registerLinksConfirmCommand(links);
  registerLinksRejectCommand(links);
}
