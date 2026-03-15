import { ok, type Result } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';

import type { AccountingScopedTransaction } from '../../cost-basis/standard/matching/build-cost-basis-scoped-transactions.js';
import { filterConfirmableTransferProposals } from '../../cost-basis/standard/matching/transfer-proposal-confirmability.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type { MatchingConfig, NewTransactionLink } from '../shared/types.js';
import type { ILinkingStrategy } from '../strategies/types.js';

export interface StrategyRunnerResult {
  links: NewTransactionLink[];
  stats: StrategyStats[];
  totalSourceCandidates: number;
  totalTargetCandidates: number;
  unmatchedSourceCandidateCount: number;
  unmatchedTargetCandidateCount: number;
}

export interface StrategyStats {
  strategyName: string;
  linksProduced: number;
  candidatesConsumed: number;
}

/**
 * Runs an ordered list of strategies on a shrinking pool of unclaimed linkable movements.
 */
export class StrategyRunner {
  constructor(
    private readonly strategies: ILinkingStrategy[],
    private readonly logger: Logger,
    private readonly config: MatchingConfig,
    private readonly scopedTransactions: AccountingScopedTransaction[]
  ) {}

  run(linkableMovements: LinkableMovement[]): Result<StrategyRunnerResult, Error> {
    // Separate non-excluded linkable movements into sources (out) / targets (in)
    const allSources: LinkableMovement[] = [];
    const allTargets: LinkableMovement[] = [];

    for (const movement of linkableMovements) {
      if (movement.excluded) continue;
      if (movement.direction === 'out') allSources.push(movement);
      else if (movement.direction === 'in') allTargets.push(movement);
    }

    this.logger.info(
      { sourceCandidateCount: allSources.length, targetCandidateCount: allTargets.length },
      'Strategy runner: separated source and target linkable movements'
    );

    const allLinks: NewTransactionLink[] = [];
    const allStats: StrategyStats[] = [];
    const claimedIds = new Set<number>();

    for (const strategy of this.strategies) {
      // Filter to unclaimed movements
      const sources = allSources.filter((m) => !claimedIds.has(m.id));
      const targets = allTargets.filter((m) => !claimedIds.has(m.id));

      if (sources.length === 0 && targets.length === 0) {
        this.logger.debug({ strategy: strategy.name }, 'Strategy skipped — no unclaimed movements');
        continue;
      }

      const result = strategy.execute(sources, targets, this.config);
      if (result.isErr()) {
        this.logger.warn(
          { strategy: strategy.name, error: result.error.message },
          'Strategy failed — continuing with next'
        );
        allStats.push({ strategyName: strategy.name, linksProduced: 0, candidatesConsumed: 0 });
        continue;
      }

      const confirmableLinks = filterConfirmableTransferProposals(
        this.scopedTransactions,
        allLinks.filter((link) => link.status === 'confirmed'),
        result.value.links,
        this.logger
      );
      const consumedCandidateIds = collectConsumedCandidateIds(confirmableLinks, sources, targets, this.logger);

      // Add consumed IDs to claimed set
      for (const id of consumedCandidateIds) {
        claimedIds.add(id);
      }

      allLinks.push(...confirmableLinks);
      allStats.push({
        strategyName: strategy.name,
        linksProduced: confirmableLinks.length,
        candidatesConsumed: consumedCandidateIds.size,
      });

      this.logger.info(
        {
          strategy: strategy.name,
          linksProduced: confirmableLinks.length,
          candidatesConsumed: consumedCandidateIds.size,
          remainingSourceCandidates: allSources.filter((m) => !claimedIds.has(m.id)).length,
          remainingTargetCandidates: allTargets.filter((m) => !claimedIds.has(m.id)).length,
        },
        'Strategy completed'
      );
    }

    const unmatchedSourceCandidateCount = allSources.filter((m) => !claimedIds.has(m.id)).length;
    const unmatchedTargetCandidateCount = allTargets.filter((m) => !claimedIds.has(m.id)).length;

    return ok({
      links: allLinks,
      stats: allStats,
      totalSourceCandidates: allSources.length,
      totalTargetCandidates: allTargets.length,
      unmatchedSourceCandidateCount,
      unmatchedTargetCandidateCount,
    });
  }
}

function collectConsumedCandidateIds(
  links: NewTransactionLink[],
  sources: LinkableMovement[],
  targets: LinkableMovement[],
  logger: Logger
): Set<number> {
  const sourceIdsByFingerprint = new Map(sources.map((movement) => [movement.movementFingerprint, movement.id]));
  const targetIdsByFingerprint = new Map(targets.map((movement) => [movement.movementFingerprint, movement.id]));
  const consumedCandidateIds = new Set<number>();

  for (const link of links) {
    const sourceId = sourceIdsByFingerprint.get(link.sourceMovementFingerprint);
    const targetId = targetIdsByFingerprint.get(link.targetMovementFingerprint);

    if (sourceId === undefined) {
      logger.warn(
        {
          sourceMovementFingerprint: link.sourceMovementFingerprint,
          targetMovementFingerprint: link.targetMovementFingerprint,
        },
        'Unable to map linked source movement fingerprint back to a candidate id'
      );
    } else {
      consumedCandidateIds.add(sourceId);
    }

    if (targetId === undefined) {
      logger.warn(
        {
          sourceMovementFingerprint: link.sourceMovementFingerprint,
          targetMovementFingerprint: link.targetMovementFingerprint,
        },
        'Unable to map linked target movement fingerprint back to a candidate id'
      );
    } else {
      consumedCandidateIds.add(targetId);
    }
  }

  return consumedCandidateIds;
}
