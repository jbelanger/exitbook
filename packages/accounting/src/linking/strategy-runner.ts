import type { Logger } from '@exitbook/logger';
import { ok, type Result } from 'neverthrow';

import type { LinkableMovement } from './pre-linking/types.js';
import type { ILinkingStrategy } from './strategies/types.js';
import type { MatchingConfig, NewTransactionLink } from './types.js';

export interface StrategyRunnerResult {
  links: NewTransactionLink[];
  stats: StrategyStats[];
  totalSourceMovements: number;
  totalTargetMovements: number;
  unmatchedSourceCount: number;
  unmatchedTargetCount: number;
}

export interface StrategyStats {
  strategyName: string;
  linksProduced: number;
  movementsConsumed: number;
}

/**
 * Runs an ordered list of strategies on a shrinking pool of unclaimed movements.
 */
export class StrategyRunner {
  constructor(
    private readonly strategies: ILinkingStrategy[],
    private readonly logger: Logger,
    private readonly config: MatchingConfig
  ) {}

  run(movements: LinkableMovement[]): Result<StrategyRunnerResult, Error> {
    // Separate non-excluded movements into sources (out) / targets (in)
    const allSources: LinkableMovement[] = [];
    const allTargets: LinkableMovement[] = [];

    for (const m of movements) {
      if (m.excluded) continue;
      if (m.direction === 'out') allSources.push(m);
      else if (m.direction === 'in') allTargets.push(m);
    }

    this.logger.info(
      { sourceCount: allSources.length, targetCount: allTargets.length },
      'Strategy runner: separated sources and targets'
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
        allStats.push({ strategyName: strategy.name, linksProduced: 0, movementsConsumed: 0 });
        continue;
      }

      const { links, consumedMovementIds } = result.value;

      // Add consumed IDs to claimed set
      for (const id of consumedMovementIds) {
        claimedIds.add(id);
      }

      allLinks.push(...links);
      allStats.push({
        strategyName: strategy.name,
        linksProduced: links.length,
        movementsConsumed: consumedMovementIds.size,
      });

      this.logger.info(
        {
          strategy: strategy.name,
          linksProduced: links.length,
          movementsConsumed: consumedMovementIds.size,
          remainingSources: allSources.filter((m) => !claimedIds.has(m.id)).length,
          remainingTargets: allTargets.filter((m) => !claimedIds.has(m.id)).length,
        },
        'Strategy completed'
      );
    }

    const unmatchedSourceCount = allSources.filter((m) => !claimedIds.has(m.id)).length;
    const unmatchedTargetCount = allTargets.filter((m) => !claimedIds.has(m.id)).length;

    return ok({
      links: allLinks,
      stats: allStats,
      totalSourceMovements: allSources.length,
      totalTargetMovements: allTargets.length,
      unmatchedSourceCount,
      unmatchedTargetCount,
    });
  }
}
