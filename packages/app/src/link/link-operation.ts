import {
  applyLinkOverrides,
  buildLinkFromOrphanedOverride,
  buildMatchingConfig,
  categorizeFinalLinks,
  defaultStrategies,
  materializeLinkableMovements,
  StrategyRunner,
  type LinkableMovement,
} from '@exitbook/accounting';
import type { NewTransactionLink, OverrideEvent, UniversalTransactionData } from '@exitbook/core';
import type { DataContext, OverrideStore } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { assignInMemoryIds, emptyLinkingResult } from './link-operation-utils.js';
import type { LinkingEvent } from './linking-events.js';

/**
 * Links run handler parameters.
 */
export interface LinkingRunParams {
  /** Whether to run in dry-run mode (no database writes) */
  dryRun: boolean;

  /** Minimum confidence score to suggest a match (0-1) */
  minConfidenceScore: Decimal;

  /** Auto-confirm matches above this confidence (0-1) */
  autoConfirmThreshold: Decimal;
}

/**
 * Result of the links run operation.
 */
export interface LinkingRunResult {
  /** Number of existing links cleared before running (undefined if none or dry run) */
  existingLinksCleared?: number | undefined;

  /** Number of internal links (same tx hash) */
  internalLinksCount: number;

  /** Number of confirmed links (auto-confirmed, >=95%) */
  confirmedLinksCount: number;

  /** Number of suggested links (needs manual review, 70-95%) */
  suggestedLinksCount: number;

  /** Total source transactions analyzed */
  totalSourceTransactions: number;

  /** Total target transactions analyzed */
  totalTargetTransactions: number;

  /** Number of unmatched source transactions */
  unmatchedSourceCount: number;

  /** Number of unmatched target transactions */
  unmatchedTargetCount: number;

  /** Total links saved to database (undefined if dry run) */
  totalSaved?: number | undefined;

  /** Whether this was a dry run */
  dryRun: boolean;
}

const logger = getLogger('LinkOperation');

/**
 * App-layer operation for transaction linking.
 * Orchestrates: load → clear → materialize → match → apply overrides → save.
 *
 * Delegates to pure domain functions in @exitbook/accounting for
 * materialization, strategy matching, and override replay.
 */
export class LinkOperation {
  constructor(
    private readonly db: DataContext,
    private readonly overrideStore?: OverrideStore | undefined,
    private readonly eventBus?: EventBus<LinkingEvent> | undefined
  ) {}

  async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
    // Read overrides from filesystem
    const overridesResult = await this.readLinkOverrides();
    if (overridesResult.isErr()) return err(overridesResult.error);
    const overrides = overridesResult.value;

    // 1. Load transactions
    this.eventBus?.emit({ type: 'load.started' });

    const loadResult = await this.db.transactions.findAll();
    if (loadResult.isErr()) return err(loadResult.error);

    const transactions = loadResult.value;
    if (transactions.length === 0) {
      return ok(emptyLinkingResult(params.dryRun));
    }

    const txById = new Map<number, UniversalTransactionData>();
    for (const tx of transactions) {
      txById.set(tx.id, tx);
    }

    logger.info({ transactionCount: transactions.length }, 'Fetched transactions for linking');
    this.eventBus?.emit({ type: 'load.completed', totalTransactions: transactions.length });

    // 2. Clear existing links (unless dry run) — both tables cleared in parallel
    let existingLinksCleared: number | undefined;
    if (!params.dryRun) {
      const [clearLinksResult, clearMovementsResult] = await Promise.all([
        this.db.transactionLinks.deleteAll(),
        this.db.linkableMovements.deleteAll(),
      ]);

      if (clearLinksResult.isErr()) return err(clearLinksResult.error);

      // Non-fatal: log warning but continue if movements clear fails
      if (clearMovementsResult.isErr()) {
        logger.warn({ error: clearMovementsResult.error }, 'Failed to clear linkable movements');
      }

      const count = clearLinksResult.value;
      if (count > 0) {
        existingLinksCleared = count;
        logger.info({ count }, 'Cleared existing links');
        this.eventBus?.emit({ type: 'existing.cleared', count });
      }
    }

    // 3. Materialize linkable movements
    this.eventBus?.emit({ type: 'materialize.started' });
    const materializeResult = materializeLinkableMovements(transactions, logger);
    if (materializeResult.isErr()) return err(materializeResult.error);

    const { movements, internalLinks } = materializeResult.value;
    this.eventBus?.emit({
      type: 'materialize.completed',
      movementCount: movements.length,
      internalLinkCount: internalLinks.length,
    });

    // 4. Persist linkable movements and get back rows with real IDs
    let movementsWithIds: LinkableMovement[];
    if (!params.dryRun) {
      const persistResult = await this.db.linkableMovements.createBatch(movements);
      if (persistResult.isErr()) return err(persistResult.error);

      const readBackResult = await this.db.linkableMovements.findAll();
      if (readBackResult.isErr()) return err(readBackResult.error);
      movementsWithIds = readBackResult.value;
    } else {
      movementsWithIds = assignInMemoryIds(movements);
    }

    // 5. Run strategy-based matching
    this.eventBus?.emit({ type: 'match.started' });

    const config = buildMatchingConfig({
      minConfidenceScore: params.minConfidenceScore,
      autoConfirmThreshold: params.autoConfirmThreshold,
    });

    const runner = new StrategyRunner(defaultStrategies(), logger, config);
    const runResult = runner.run(movementsWithIds);
    if (runResult.isErr()) return err(runResult.error);

    const strategyResult = runResult.value;

    // Combine internal links with strategy links
    const allLinks: NewTransactionLink[] = [...internalLinks, ...strategyResult.links];

    // 6. Apply user overrides
    const overrideResult = this.replayOverrides(allLinks, overrides, transactions, txById);
    if (overrideResult.isErr()) return err(overrideResult.error);

    const finalLinks = overrideResult.value;

    // 7. Emit match results
    const { internalCount, confirmedCount, suggestedCount } = categorizeFinalLinks(finalLinks);
    this.eventBus?.emit({
      type: 'match.completed',
      sourceCount: strategyResult.totalSourceMovements,
      targetCount: strategyResult.totalTargetMovements,
      internalCount,
      confirmedCount,
      suggestedCount,
    });

    // 8. Persist (unless dry run)
    let totalSaved: number | undefined;
    if (!params.dryRun) {
      const saveResult = await this.saveLinks(finalLinks);
      if (saveResult.isErr()) return err(saveResult.error);
      totalSaved = saveResult.value;
    }

    return ok({
      existingLinksCleared,
      internalLinksCount: internalCount,
      confirmedLinksCount: confirmedCount,
      suggestedLinksCount: suggestedCount,
      totalSourceTransactions: strategyResult.totalSourceMovements,
      totalTargetTransactions: strategyResult.totalTargetMovements,
      unmatchedSourceCount: strategyResult.unmatchedSourceCount,
      unmatchedTargetCount: strategyResult.unmatchedTargetCount,
      totalSaved,
      dryRun: params.dryRun,
    });
  }

  private async readLinkOverrides(): Promise<Result<OverrideEvent[], Error>> {
    if (!this.overrideStore) return ok([]);

    if (!this.overrideStore.exists()) return ok([]);

    const result = await this.overrideStore.readAll();
    if (result.isErr()) {
      return err(new Error(`Failed to read override events: ${result.error.message}`));
    }

    return ok(result.value);
  }

  /**
   * Replay user overrides (confirm/reject) on top of algorithm-generated links.
   * Returns original links unchanged if no overrides provided.
   */
  private replayOverrides(
    links: NewTransactionLink[],
    overrides: OverrideEvent[],
    transactions: UniversalTransactionData[],
    txById: Map<number, UniversalTransactionData>
  ): Result<NewTransactionLink[], Error> {
    if (overrides.length === 0) return ok(links);

    logger.info({ count: overrides.length }, 'Applying link override events');

    const applyResult = applyLinkOverrides(links, overrides, transactions);
    if (applyResult.isErr()) return err(applyResult.error);

    const { links: finalLinks, orphaned, unresolved } = applyResult.value;

    for (const entry of orphaned) {
      const linkResult = buildLinkFromOrphanedOverride(entry, txById);
      if (linkResult.isErr()) {
        logger.error(
          {
            overrideId: entry.override.id,
            sourceTransactionId: entry.sourceTransactionId,
            targetTransactionId: entry.targetTransactionId,
            asset: entry.assetSymbol,
          },
          `Skipping orphaned override: ${linkResult.error.message}`
        );
        continue;
      }
      finalLinks.push(linkResult.value);
      logger.info(
        {
          overrideId: entry.override.id,
          sourceTransactionId: entry.sourceTransactionId,
          targetTransactionId: entry.targetTransactionId,
          asset: entry.assetSymbol,
        },
        'Created link from override (algorithm did not rediscover this pair)'
      );
    }

    if (unresolved.length > 0) {
      logger.warn(
        { unresolvedCount: unresolved.length },
        'Some override events could not resolve transaction fingerprints'
      );
    }

    return ok(finalLinks);
  }

  private async saveLinks(links: NewTransactionLink[]): Promise<Result<number | undefined, Error>> {
    const linksToSave = links.filter((l) => l.status !== 'rejected');
    if (linksToSave.length === 0) return ok(undefined);

    this.eventBus?.emit({ type: 'save.started' });

    const saveResult = await this.db.transactionLinks.createBatch(linksToSave);
    if (saveResult.isErr()) return err(saveResult.error);

    logger.info({ count: saveResult.value }, 'Saved links to database');
    this.eventBus?.emit({ type: 'save.completed', totalSaved: saveResult.value });
    return ok(saveResult.value);
  }
}
