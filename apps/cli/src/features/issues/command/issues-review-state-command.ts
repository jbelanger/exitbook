import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';

import { resolveCurrentIssueData } from './issues-data.js';

const IssueSelectorArgumentSchema = z.string().trim().min(1, 'Issue ref must not be empty');

type IssuesReviewStateAction = 'acknowledge' | 'reopen';

interface IssuesReviewStateCommandDefinition<TAction extends IssuesReviewStateAction> {
  action: TAction;
  commandId: `issues-${TAction}`;
  commandName: TAction;
  description: string;
}

interface IssuesReviewStateResult {
  action: IssuesReviewStateAction;
  changed: boolean;
  issueRef: string;
  reviewState: 'open' | 'acknowledged';
  summary: string;
  scopeKey: string;
}

const ISSUES_REVIEW_STATE_COMMANDS = {
  acknowledge: {
    action: 'acknowledge',
    commandId: 'issues-acknowledge',
    commandName: 'acknowledge',
    description: 'Acknowledge one current accounting issue without changing accounting truth',
  },
  reopen: {
    action: 'reopen',
    commandId: 'issues-reopen',
    commandName: 'reopen',
    description: 'Clear a prior accounting issue acknowledgement',
  },
} as const satisfies Record<IssuesReviewStateAction, IssuesReviewStateCommandDefinition<IssuesReviewStateAction>>;

export function registerIssuesAcknowledgeCommand(issuesCommand: Command): void {
  registerIssuesReviewStateCommand(issuesCommand, ISSUES_REVIEW_STATE_COMMANDS.acknowledge);
}

export function registerIssuesReopenCommand(issuesCommand: Command): void {
  registerIssuesReviewStateCommand(issuesCommand, ISSUES_REVIEW_STATE_COMMANDS.reopen);
}

export async function runIssuesAcknowledgeCommand(selector: string, rawOptions: unknown) {
  return executeIssuesReviewStateCommand(ISSUES_REVIEW_STATE_COMMANDS.acknowledge, selector, rawOptions);
}

export async function runIssuesReopenCommand(selector: string, rawOptions: unknown) {
  return executeIssuesReviewStateCommand(ISSUES_REVIEW_STATE_COMMANDS.reopen, selector, rawOptions);
}

function registerIssuesReviewStateCommand<TAction extends IssuesReviewStateAction>(
  issuesCommand: Command,
  definition: IssuesReviewStateCommandDefinition<TAction>
): void {
  issuesCommand
    .command(`${definition.commandName} <selector>`)
    .description(definition.description)
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook issues ${definition.commandName} 2d4c8e1af3
  $ exitbook issues ${definition.commandName} 2d4c8e1af3 --json
`
    )
    .option('--json', 'Output JSON format')
    .action(async (selector: string, rawOptions: unknown) => {
      await executeIssuesReviewStateCommand(definition, selector, rawOptions);
    });
}

async function executeIssuesReviewStateCommand<TAction extends IssuesReviewStateAction>(
  definition: IssuesReviewStateCommandDefinition<TAction>,
  rawSelector: string,
  rawOptions: unknown
): Promise<unknown> {
  const format = detectCliOutputFormat(rawOptions);

  return runCliRuntimeCommand({
    command: definition.commandId,
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        return {
          options: yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema),
          selector: yield* parseIssueSelectorResult(rawSelector),
        };
      }),
    action: async ({ runtime, prepared }) =>
      executeIssuesReviewStateCommandResult(
        runtime,
        definition.action,
        prepared.selector,
        prepared.options.json ? 'json' : 'text'
      ),
  });
}

async function executeIssuesReviewStateCommandResult(
  runtime: CommandRuntime,
  action: IssuesReviewStateAction,
  selector: string,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const resolved = yield* await resolveCurrentIssueData(runtime, format, selector);
    const database = await runtime.database();
    const mutationResult = yield* toCliResult(
      action === 'acknowledge'
        ? await database.accountingIssues.acknowledgeCurrentIssue(resolved.scopeKey, resolved.issueKey, new Date())
        : await database.accountingIssues.reopenCurrentIssue(resolved.scopeKey, resolved.issueKey),
      ExitCodes.GENERAL_ERROR
    );

    if (!mutationResult.found) {
      return yield* err(
        createCliFailure(new Error(`Issue ref '${selector.trim().toLowerCase()}' not found`), ExitCodes.NOT_FOUND)
      );
    }

    const refreshed = yield* await resolveCurrentIssueData(runtime, format, selector);
    const result: IssuesReviewStateResult = {
      action,
      changed: mutationResult.changed,
      issueRef: refreshed.issue.issueRef,
      scopeKey: refreshed.scopeKey,
      reviewState: refreshed.issue.reviewState,
      summary: refreshed.issue.summary,
    };

    if (format === 'json') {
      return jsonSuccess(result);
    }

    return textSuccess(() => {
      printIssuesReviewStateResult(result);
    });
  });
}

function parseIssueSelectorResult(rawSelector: string): Result<string, ReturnType<typeof createCliFailure>> {
  const parseResult = IssueSelectorArgumentSchema.safeParse(rawSelector);
  if (!parseResult.success) {
    return err(
      createCliFailure(new Error(parseResult.error.issues[0]?.message ?? 'Invalid issue ref'), ExitCodes.INVALID_ARGS)
    );
  }

  return ok(parseResult.data);
}

function printIssuesReviewStateResult(result: IssuesReviewStateResult): void {
  if (result.action === 'acknowledge') {
    console.log(formatSuccessLine(result.changed ? 'Issue acknowledged' : 'Issue already acknowledged'));
  } else {
    console.log(formatSuccessLine(result.changed ? 'Issue acknowledgement reopened' : 'Issue is already open'));
  }

  console.log(`   Issue: ${result.issueRef}`);
  console.log(`   Review: ${result.reviewState}`);
  console.log(`   Scope: ${result.scopeKey}`);
  console.log(`   Summary: ${result.summary}`);
}
