import type { Command } from 'commander';

import { registerIssuesBrowseOptions, runIssuesListCommand } from './issues-browse-command.js';

export function registerIssuesListCommand(issuesCommand: Command): void {
  registerIssuesBrowseOptions(
    issuesCommand
      .command('list')
      .description('Show the current accounting issues overview')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook issues list
  $ exitbook issues list --json
`
      )
  ).action(async (rawOptions: unknown) => {
    await runIssuesListCommand('issues-list', rawOptions);
  });
}
