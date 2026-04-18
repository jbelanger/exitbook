import { buildLinkGapIssueKey, buildProfileLinkGapAnalysis, type LinkGapIssue } from '@exitbook/accounting/linking';
import { buildProfileLinkGapSourceReader } from '@exitbook/data/accounting';
import { OverrideStore, readResolvedLinkGapExceptions, type ResolvedLinkGapException } from '@exitbook/data/overrides';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import {
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../../cli/options.js';
import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../../profiles/profile-resolution.js';
import { buildDefinedFilters, buildViewMeta } from '../../../shared/view-utils.js';
import { formatTransactionFingerprintRef } from '../../../transactions/transaction-selector.js';
import { buildLinkGapRef } from '../../link-selector.js';
import type { ResolvedLinkGapBrowseItem } from '../../links-gaps-browse-model.js';
import { outputResolvedLinkGapsStaticList } from '../../view/links-static-renderer.js';
import { LinksGapsBrowseCommandOptionsSchema } from '../links-option-schemas.js';

export function registerLinksGapsResolvedCommand(gapsCommand: Command): void {
  gapsCommand
    .command('resolved')
    .description('Show currently-resolved link gap exceptions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links gaps resolved
  $ exitbook links gaps resolved --json

Notes:
  - Shows only gap exceptions that are currently resolved and still exist in the latest gap analysis.
  - Use "links gaps reopen <gap-ref>" to undo a resolved gap exception.
`
    )
    .option('--json', 'Output JSON format')
    .action(async (rawOptions: unknown) => {
      await runLinksGapsResolvedCommand('links-gaps-resolved', rawOptions);
    });
}

export async function runLinksGapsResolvedCommand(commandId: string, rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: commandId,
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, LinksGapsBrowseCommandOptionsSchema);
      }),
    action: async ({ runtime, prepared }) => executeLinksGapsResolvedCommand(runtime, prepared.json === true),
  });
}

async function executeLinksGapsResolvedCommand(runtime: CommandRuntime, asJson: boolean): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await runtime.database();
    const profile = yield* toCliResult(await resolveCommandProfile(runtime, database), ExitCodes.GENERAL_ERROR);
    const sourceReader = buildProfileLinkGapSourceReader(database, runtime.dataDir, {
      profileId: profile.id,
      profileKey: profile.profileKey,
    });
    const source = yield* toCliResult(await sourceReader.loadProfileLinkGapSourceData(), ExitCodes.GENERAL_ERROR);
    const resolvedExceptions = yield* toCliResult(
      await readResolvedLinkGapExceptions(new OverrideStore(runtime.dataDir), profile.profileKey),
      ExitCodes.GENERAL_ERROR
    );
    const items = buildResolvedLinkGapBrowseItems(buildProfileLinkGapAnalysis(source).issues, resolvedExceptions);

    if (asJson) {
      return jsonSuccess({
        data: items.map(serializeResolvedGapSummary),
        meta: buildViewMeta(
          items.length,
          0,
          items.length,
          items.length,
          buildDefinedFilters({
            resolvedGapExceptions: items.length,
          })
        ),
      });
    }

    return textSuccess(() => {
      outputResolvedLinkGapsStaticList(items);
    });
  });
}

function buildResolvedLinkGapBrowseItems(
  issues: readonly LinkGapIssue[],
  resolvedExceptions: ReadonlyMap<string, ResolvedLinkGapException>
): ResolvedLinkGapBrowseItem[] {
  return issues
    .flatMap((gapIssue) => {
      const issueKey = buildLinkGapIssueKey({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      });
      const resolvedException = resolvedExceptions.get(issueKey);

      if (resolvedException === undefined) {
        return [];
      }

      return [
        {
          gapRef: buildLinkGapRef({
            txFingerprint: gapIssue.txFingerprint,
            assetId: gapIssue.assetId,
            direction: gapIssue.direction,
          }),
          gapIssue,
          reason: resolvedException.reason,
          resolvedAt: resolvedException.resolvedAt,
          transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
        },
      ];
    })
    .sort(compareResolvedLinkGapBrowseItems);
}

function compareResolvedLinkGapBrowseItems(left: ResolvedLinkGapBrowseItem, right: ResolvedLinkGapBrowseItem): number {
  const leftResolvedAt = Date.parse(left.resolvedAt);
  const rightResolvedAt = Date.parse(right.resolvedAt);

  if (!Number.isNaN(leftResolvedAt) && !Number.isNaN(rightResolvedAt) && leftResolvedAt !== rightResolvedAt) {
    return rightResolvedAt - leftResolvedAt;
  }

  const resolvedAtCompare = right.resolvedAt.localeCompare(left.resolvedAt);
  if (resolvedAtCompare !== 0) {
    return resolvedAtCompare;
  }

  const timestampCompare = right.gapIssue.timestamp.localeCompare(left.gapIssue.timestamp);
  if (timestampCompare !== 0) {
    return timestampCompare;
  }

  return left.gapRef.localeCompare(right.gapRef);
}

function serializeResolvedGapSummary(item: ResolvedLinkGapBrowseItem): Record<string, unknown> {
  return {
    kind: 'resolved-gap',
    ref: item.gapRef,
    transactionRef: item.transactionRef,
    transactionId: item.gapIssue.transactionId,
    txFingerprint: item.gapIssue.txFingerprint,
    platformKey: item.gapIssue.platformKey,
    blockchainName: item.gapIssue.blockchainName,
    timestamp: item.gapIssue.timestamp,
    assetId: item.gapIssue.assetId,
    assetSymbol: item.gapIssue.assetSymbol,
    missingAmount: item.gapIssue.missingAmount,
    totalAmount: item.gapIssue.totalAmount,
    confirmedCoveragePercent: item.gapIssue.confirmedCoveragePercent,
    operationCategory: item.gapIssue.operationCategory,
    operationType: item.gapIssue.operationType,
    direction: item.gapIssue.direction,
    reason: item.reason,
    resolvedAt: item.resolvedAt,
  };
}
