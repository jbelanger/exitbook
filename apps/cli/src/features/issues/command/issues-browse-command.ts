import { resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  type CliFailure,
} from '../../../cli/command.js';
import {
  detectCliOutputFormat,
  parseCliBrowseRootInvocationResult,
  parseCliCommandOptionsResult,
} from '../../../cli/options.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { type IssuesStaticDetailState, type IssuesStaticOverviewState } from '../view/issues-static-renderer.js';
import { outputIssuesStaticDetail, outputIssuesStaticOverview } from '../view/issues-static-renderer.js';

import type { IssuesOverviewData, IssuesViewData } from './issues-data.js';
import { loadIssueViewData, loadIssuesOverviewData } from './issues-data.js';

export function registerIssuesBrowseOptions(command: Command): Command {
  return command.option('--json', 'Output results in JSON format');
}

export function parseIssuesBrowseRootInvocationResult(
  tokens: string[] | undefined
): Result<{ rawOptions: Record<string, unknown>; selector?: string | undefined }, CliFailure> {
  return parseCliBrowseRootInvocationResult(tokens, registerIssuesBrowseOptions);
}

export function buildIssuesRootSelectorError(selector: string): Result<never, CliFailure> {
  return cliErr(`Use "issues view ${selector}" for static detail.`, ExitCodes.INVALID_ARGS);
}

export async function runIssuesListCommand(commandId: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: commandId,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema);
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const data = yield* await loadIssuesOverviewData(runtime, prepared.json ? 'json' : 'text');

        if (prepared.json) {
          return jsonSuccess({
            summary: {
              openIssueCount: data.scope.openIssueCount,
              blockingIssueCount: data.scope.blockingIssueCount,
              status: data.scope.status,
            },
            currentIssues: data.issueRecords.map((record) => record.issue),
            scopedLenses: data.scopedLenses,
          });
        }

        return textSuccess(() => {
          outputIssuesStaticOverview(toIssuesOverviewState(data));
        });
      }),
  });
}

export async function runIssuesViewCommand(commandId: string, selector: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: commandId,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return {
          options: yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema),
          selector,
        };
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const data = yield* await loadIssueViewData(
          runtime,
          prepared.options.json ? 'json' : 'text',
          prepared.selector
        );

        if (prepared.options.json) {
          return jsonSuccess(data.issue);
        }

        return textSuccess(() => {
          outputIssuesStaticDetail(toIssuesDetailState(data));
        });
      }),
  });
}

function toIssuesOverviewState(data: IssuesOverviewData): IssuesStaticOverviewState {
  return {
    activeProfileKey: data.activeProfileKey,
    activeProfileSource: data.activeProfileSource,
    currentIssues: data.issueRecords.map((record) => record.issue),
    profileDisplayName: data.profileDisplayName,
    scope: data.scope,
    scopedLenses: data.scopedLenses,
  };
}

function toIssuesDetailState(data: IssuesViewData): IssuesStaticDetailState {
  return {
    activeProfileKey: data.activeProfileKey,
    activeProfileSource: data.activeProfileSource,
    issue: data.issue,
    profileDisplayName: data.profileDisplayName,
  };
}
