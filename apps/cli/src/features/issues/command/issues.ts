import { Command } from 'commander';

import { exitCliFailure } from '../../../cli/error.js';
import { detectCliTokenOutputFormat } from '../../../cli/options.js';

import {
  buildIssuesRootSelectorError,
  parseIssuesBrowseRootInvocationResult,
  runIssuesListCommand,
} from './issues-browse-command.js';
import { registerIssuesCostBasisCommand } from './issues-cost-basis.js';
import { registerIssuesListCommand } from './issues-list.js';
import { registerIssuesViewCommand } from './issues-view.js';

const ISSUES_COMMAND_ID = 'issues';

export function registerIssuesCommand(program: Command): void {
  const issues = program
    .command('issues')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Review remaining accounting work and next actions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook issues
  $ exitbook issues list
  $ exitbook issues view 2d4c8e1af3
  $ exitbook issues cost-basis --jurisdiction CA --tax-year 2024 --method average-cost

Notes:
  - Bare "issues" is the operator work queue overview for the active profile.
  - Use "issues view <ISSUE-REF>" for one static issue detail card.
  - Issues are a persisted derived projection. Corrective actions stay in owning workflows.
`
    )
    .action(async (tokens: string[] | undefined) => {
      const format = detectCliTokenOutputFormat(tokens);
      const parsedInvocationResult = parseIssuesBrowseRootInvocationResult(tokens);
      if (parsedInvocationResult.isErr()) {
        exitCliFailure(ISSUES_COMMAND_ID, parsedInvocationResult.error, format);
        return;
      }

      const selector = parsedInvocationResult.value.selector?.trim();
      if (selector) {
        const selectorErrorResult = buildIssuesRootSelectorError(selector);
        if (selectorErrorResult.isErr()) {
          exitCliFailure(ISSUES_COMMAND_ID, selectorErrorResult.error, format);
          return;
        }
      }

      await runIssuesListCommand(ISSUES_COMMAND_ID, parsedInvocationResult.value.rawOptions);
    });

  registerIssuesListCommand(issues);
  registerIssuesViewCommand(issues);
  registerIssuesCostBasisCommand(issues);
}
