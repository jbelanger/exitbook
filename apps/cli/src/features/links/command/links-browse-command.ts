import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliBrowseOptionsResult } from '../../../cli/options.js';
import {
  collapseEmptyExplorerToStatic,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../cli/presentation.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import { getLinkSelectorErrorExitCode } from '../link-selector.js';
import type { LinkGapBrowseItem, LinkProposalBrowseItem } from '../links-browse-model.js';
import { LinksViewApp } from '../view/index.js';
import {
  outputLinkGapStaticDetail,
  outputLinkGapsStaticList,
  outputLinkProposalStaticDetail,
  outputLinksStaticList,
} from '../view/links-static-renderer.js';
import {
  formatMatchCriteria,
  formatProposalConfidence,
  formatProposalRoute,
  getProposalAmountDisplay,
} from '../view/links-view-formatters.js';

import {
  buildLinksBrowsePresentation,
  type LinksBrowseParams,
  type LinksBrowsePresentation,
} from './links-browse-support.js';
import { LinksBrowseCommandOptionsSchema } from './links-option-schemas.js';
import { LinksReviewHandler } from './review/links-review-handler.js';

export interface PreparedLinksBrowseCommand {
  params: LinksBrowseParams;
  presentation: ResolvedBrowsePresentation;
}

interface ExecuteLinksBrowseCommandInput {
  commandId: string;
  optionOverrides?: Record<string, unknown> | undefined;
  rawOptions: unknown;
  selector?: string | undefined;
  surfaceSpec: BrowseSurfaceSpec;
}

interface LinksBrowseOptionDefinition {
  description: string;
  flags: string;
  parser?: (value: string) => unknown;
}

const LINKS_BROWSE_OPTION_DEFINITIONS: LinksBrowseOptionDefinition[] = [
  {
    flags: '--status <status>',
    description: 'Filter proposals by status (suggested, confirmed, rejected)',
  },
  {
    flags: '--gaps',
    description: 'Show coverage gaps instead of link proposals',
  },
  {
    flags: '--min-confidence <score>',
    description: 'Filter proposals by minimum confidence score (0-1)',
    parser: parseFloat,
  },
  {
    flags: '--max-confidence <score>',
    description: 'Filter proposals by maximum confidence score (0-1)',
    parser: parseFloat,
  },
  {
    flags: '--verbose',
    description: 'Include full transaction details in proposal detail surfaces',
  },
  {
    flags: '--json',
    description: 'Output JSON format',
  },
];

export function registerLinksBrowseOptions(command: Command): Command {
  for (const option of LINKS_BROWSE_OPTION_DEFINITIONS) {
    if (option.parser) {
      command.option(option.flags, option.description, option.parser);
      continue;
    }

    command.option(option.flags, option.description);
  }

  return command;
}

export function buildLinksBrowseOptionsHelpText(): string {
  const flagsColumnWidth =
    LINKS_BROWSE_OPTION_DEFINITIONS.reduce((maxWidth, option) => Math.max(maxWidth, option.flags.length), 0) + 2;

  return LINKS_BROWSE_OPTION_DEFINITIONS.map((option) => {
    return `  ${option.flags.padEnd(flagsColumnWidth)}${option.description}`;
  }).join('\n');
}

export function prepareLinksBrowseCommand(
  input: ExecuteLinksBrowseCommandInput
): Result<PreparedLinksBrowseCommand, CliFailure> {
  const effectiveRawOptions = mergeOptionOverrides(input.rawOptions, input.optionOverrides);
  const parsedOptionsResult = parseCliBrowseOptionsResult(
    effectiveRawOptions,
    LinksBrowseCommandOptionsSchema,
    input.surfaceSpec
  );
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const { options, presentation } = parsedOptionsResult.value;
  const selector = input.selector?.trim();

  if (
    selector &&
    (options.status !== undefined || options.minConfidence !== undefined || options.maxConfidence !== undefined)
  ) {
    return err(
      createCliFailure(
        new Error(
          'Link selector cannot be combined with --status, --min-confidence, or --max-confidence; use the selector alone or browse the filtered list first'
        ),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok({
    params: {
      gaps: options.gaps,
      maxConfidence: options.maxConfidence,
      minConfidence: options.minConfidence,
      preselectInExplorer: selector !== undefined && presentation.mode === 'tui' ? true : undefined,
      selector,
      status: options.status,
      verbose: options.verbose,
    },
    presentation,
  });
}

export async function runLinksBrowseCommand(input: ExecuteLinksBrowseCommandInput): Promise<void> {
  await runCliRuntimeCommand({
    command: input.commandId,
    format: detectCliOutputFormat(mergeOptionOverrides(input.rawOptions, input.optionOverrides)),
    prepare: async () => prepareLinksBrowseCommand(input),
    action: async (context) => executePreparedLinksBrowseCommand(context.runtime, context.prepared),
  });
}

export async function executePreparedLinksBrowseCommand(
  runtime: CommandRuntime,
  prepared: PreparedLinksBrowseCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await runtime.database();
    const profile = yield* toCliResult(await resolveCommandProfile(runtime, database), ExitCodes.GENERAL_ERROR);
    const browsePresentationResult = await buildLinksBrowsePresentation(database, profile.id, prepared.params);
    const browsePresentation = browsePresentationResult.isErr()
      ? yield* err(
          createCliFailure(browsePresentationResult.error, getLinkSelectorErrorExitCode(browsePresentationResult.error))
        )
      : browsePresentationResult.value;
    const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
      hasNavigableItems: hasNavigableItems(browsePresentation),
      shouldCollapseEmptyExplorer: prepared.params.selector === undefined,
    });

    if (finalPresentation.mode === 'tui') {
      yield* toCliResult(
        await renderLinksExploreTui(runtime, database, profile, browsePresentation),
        ExitCodes.GENERAL_ERROR
      );
      return silentSuccess();
    }

    return yield* toCliResult(
      buildLinksBrowseCompletion(browsePresentation, finalPresentation, prepared.params),
      ExitCodes.GENERAL_ERROR
    );
  });
}

function buildLinksBrowseCompletion(
  browsePresentation: LinksBrowsePresentation,
  presentation: ResolvedBrowsePresentation,
  params: LinksBrowseParams
): Result<CliCompletion, Error> {
  if (presentation.mode === 'json') {
    return ok(buildLinksBrowseJsonCompletion(browsePresentation, presentation.staticKind, params));
  }

  if (presentation.staticKind === 'detail') {
    if (browsePresentation.mode === 'gaps') {
      if (!browsePresentation.selectedGap) {
        return err(new Error('Expected a selected link gap'));
      }

      const selectedGap = browsePresentation.selectedGap;
      return ok(
        textSuccess(() => {
          outputLinkGapStaticDetail(selectedGap);
        })
      );
    }

    if (!browsePresentation.selectedProposal) {
      return err(new Error('Expected a selected link proposal'));
    }

    const selectedProposal = browsePresentation.selectedProposal;
    return ok(
      textSuccess(() => {
        outputLinkProposalStaticDetail(selectedProposal, params.verbose ?? false);
      })
    );
  }

  if (browsePresentation.mode === 'gaps') {
    return ok(
      textSuccess(() => {
        outputLinkGapsStaticList(browsePresentation.state, browsePresentation.gaps);
      })
    );
  }

  return ok(
    textSuccess(() => {
      outputLinksStaticList(browsePresentation.state, browsePresentation.proposals);
    })
  );
}

function buildLinksBrowseJsonCompletion(
  browsePresentation: LinksBrowsePresentation,
  staticKind: 'detail' | 'list',
  params: LinksBrowseParams
): CliCompletion {
  if (staticKind === 'detail') {
    if (browsePresentation.mode === 'gaps') {
      return jsonSuccess(
        {
          data: browsePresentation.selectedGap ? serializeGapDetail(browsePresentation.selectedGap) : undefined,
          meta: buildViewMeta(1, 0, 1, 1, buildDefinedFilters({ gaps: true, transaction: params.selector })),
        },
        undefined
      );
    }

    return jsonSuccess(
      {
        data: browsePresentation.selectedProposal
          ? serializeProposalDetail(browsePresentation.selectedProposal, params.verbose ?? false)
          : undefined,
        meta: buildViewMeta(1, 0, 1, 1, buildDefinedFilters({ proposal: params.selector })),
      },
      undefined
    );
  }

  if (browsePresentation.mode === 'gaps') {
    return jsonSuccess(
      {
        data: browsePresentation.gaps.map(serializeGapSummary),
        meta: buildViewMeta(
          browsePresentation.gaps.length,
          0,
          browsePresentation.gaps.length,
          browsePresentation.state.linkAnalysis.issues.length,
          buildDefinedFilters({
            gaps: true,
            totalIssues: browsePresentation.state.linkAnalysis.summary.total_issues,
            uncoveredInflows: browsePresentation.state.linkAnalysis.summary.uncovered_inflows,
            unmatchedOutflows: browsePresentation.state.linkAnalysis.summary.unmatched_outflows,
          })
        ),
      },
      undefined
    );
  }

  return jsonSuccess(
    {
      data: browsePresentation.proposals.map(serializeProposalSummary),
      meta: buildViewMeta(
        browsePresentation.proposals.length,
        0,
        browsePresentation.proposals.length,
        browsePresentation.state.totalCount ?? browsePresentation.proposals.length,
        buildDefinedFilters({
          status: params.status,
          minConfidence: params.minConfidence,
          maxConfidence: params.maxConfidence,
        })
      ),
    },
    undefined
  );
}

async function renderLinksExploreTui(
  runtime: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['database']>>,
  profile: { id: number; profileKey: string },
  browsePresentation: LinksBrowsePresentation
): Promise<Result<void, Error>> {
  try {
    if (browsePresentation.mode === 'gaps') {
      await runtime.closeDatabase();
      await renderApp((unmount) =>
        React.createElement(LinksViewApp, {
          initialState: browsePresentation.state,
          onQuit: unmount,
        })
      );

      return ok(undefined);
    }

    const reviewHandler = new LinksReviewHandler(
      database as never,
      profile.id,
      profile.profileKey,
      new OverrideStore(runtime.dataDir)
    );

    await renderApp((unmount) =>
      React.createElement(LinksViewApp, {
        initialState: browsePresentation.state,
        onAction: async (linkId, action) => {
          const result = await reviewHandler.execute({ linkId }, action);
          if (result.isErr()) {
            throw result.error;
          }

          return {
            affectedLinkIds: result.value.affectedLinkIds,
            newStatus: result.value.newStatus,
          };
        },
        onQuit: unmount,
      })
    );

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function hasNavigableItems(browsePresentation: LinksBrowsePresentation): boolean {
  if (browsePresentation.mode === 'gaps') {
    return browsePresentation.gaps.length > 0;
  }

  return browsePresentation.proposals.length > 0;
}

function mergeOptionOverrides(
  rawOptions: unknown,
  overrides: Record<string, unknown> | undefined
): Record<string, unknown> {
  const baseOptions =
    typeof rawOptions === 'object' && rawOptions !== null ? { ...(rawOptions as Record<string, unknown>) } : {};
  const definedOverrides =
    overrides === undefined
      ? {}
      : Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));

  return {
    ...baseOptions,
    ...definedOverrides,
  };
}

function serializeProposalSummary(item: LinkProposalBrowseItem): Record<string, unknown> {
  return {
    kind: 'proposal',
    ref: item.proposalRef,
    representativeLinkId: item.proposal.representativeLink.id,
    assetSymbol: item.proposal.representativeLink.assetSymbol,
    route: formatProposalRoute(item.proposal),
    confidence: formatProposalConfidence(item.proposal).trim(),
    status: item.proposal.status,
    legCount: item.proposal.legs.length,
  };
}

function serializeProposalDetail(item: LinkProposalBrowseItem, verbose: boolean): Record<string, unknown> {
  const amountDisplay = getProposalAmountDisplay(item.proposal);

  return {
    ...serializeProposalSummary(item),
    resolvedLinkFingerprint: item.resolvedLinkFingerprint,
    matchedAmount: amountDisplay.matchedAmount,
    summaryLabel: amountDisplay.detailLabel,
    summary: amountDisplay.detailSummary,
    match: formatMatchCriteria(item.proposal.representativeLink.matchCriteria),
    legs: item.proposal.legs.map((leg) => ({
      linkId: leg.link.id,
      status: leg.link.status,
      sourceTransactionId: leg.link.sourceTransactionId,
      targetTransactionId: leg.link.targetTransactionId,
      sourceAmount: leg.link.sourceAmount.toFixed(),
      targetAmount: leg.link.targetAmount.toFixed(),
      assetSymbol: leg.link.assetSymbol,
      sourcePlatform: leg.sourceTransaction?.platformKey,
      targetPlatform: leg.targetTransaction?.platformKey,
      sourceTimestamp: leg.sourceTransaction?.datetime,
      targetTimestamp: leg.targetTransaction?.datetime,
      sourceAddress: verbose ? leg.sourceTransaction?.from : undefined,
      targetAddress: verbose ? leg.targetTransaction?.to : undefined,
    })),
  };
}

function serializeGapSummary(item: LinkGapBrowseItem): Record<string, unknown> {
  return {
    kind: 'gap',
    ref: item.transactionRef,
    transactionId: item.issue.transactionId,
    txFingerprint: item.issue.txFingerprint,
    source: item.issue.source,
    blockchain: item.issue.blockchain,
    timestamp: item.issue.timestamp,
    assetSymbol: item.issue.assetSymbol,
    missingAmount: item.issue.missingAmount,
    totalAmount: item.issue.totalAmount,
    confirmedCoveragePercent: item.issue.confirmedCoveragePercent,
    operationCategory: item.issue.operationCategory,
    operationType: item.issue.operationType,
    suggestedCount: item.issue.suggestedCount,
    highestSuggestedConfidencePercent: item.issue.highestSuggestedConfidencePercent,
    direction: item.issue.direction,
  };
}

function serializeGapDetail(item: LinkGapBrowseItem): Record<string, unknown> {
  return serializeGapSummary(item);
}
