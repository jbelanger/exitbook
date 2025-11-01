// Unified sessions command for managing import sessions
// Provides a single namespace for viewing import session data

import type { Command } from 'commander';

import { registerSessionsViewCommand } from './sessions-view.ts';

/**
 * Register the unified sessions command with all subcommands.
 *
 * Structure:
 *   sessions view               - View import sessions with filters
 */
export function registerSessionsCommand(program: Command): void {
  const sessions = program.command('sessions').description('Manage import sessions (view session history)');

  // Register subcommands
  registerSessionsViewCommand(sessions);
}
