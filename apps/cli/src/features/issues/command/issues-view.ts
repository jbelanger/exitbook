import type { Command } from 'commander';

import { registerIssuesBrowseOptions, runIssuesViewCommand } from './issues-browse-command.js';

export function registerIssuesViewCommand(issuesCommand: Command): void {
  registerIssuesBrowseOptions(
    issuesCommand
      .command('view <selector>')
      .description('Show static detail for one current accounting issue')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook issues view 2d4c8e1af3
  $ exitbook issues view 2d4c8e1af3 --json
`
      )
  ).action(async (selector: string, rawOptions: unknown) => {
    await runIssuesViewCommand('issues-view', selector, rawOptions);
  });
}
