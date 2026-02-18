import {
  createTransactionLink,
  DEFAULT_MATCHING_CONFIG,
  TransactionLinkingService,
  type TransactionLink,
  type TransactionLinkRepository,
} from '@exitbook/accounting';
import { parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import { applyLinkOverrides, type OrphanedLinkOverride, type OverrideStore } from '@exitbook/data';
import type { TransactionQueries } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import type { LinkingEvent } from './events.js';

/**
 * Links run handler parameters.
 */
export interface LinksRunHandlerParams {
  /** Whether to run in dry-run mode (no database writes) */
  dryRun: boolean;

  /** Minimum confidence score to suggest a match (0-1) */
  minConfidenceScore: Decimal;

  /** Auto-confirm matches above this confidence (0-1) */
  autoConfirmThreshold: Decimal;
}

const logger = getLogger('LinksRunHandler');

/**
 * Result of the links run operation.
 */
export interface LinksRunResult {
  /** Number of existing links cleared before running (undefined if none or dry run) */
  existingLinksCleared?: number | undefined;

  /** Number of internal links (same tx hash) */
  internalLinksCount: number;

  /** Number of confirmed links (auto-confirmed, ≥95%) */
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

/**
 * Links run handler - encapsulates all transaction linking business logic.
 * Reusable by both CLI command and other contexts.
 */
export class LinksRunHandler {
  constructor(
    private transactionRepository: TransactionQueries,
    private linkRepository: TransactionLinkRepository,
    private overrideStore?: OverrideStore | undefined,
    private eventBus?: EventBus<LinkingEvent> | undefined
  ) {}

  /**
   * Execute the links run operation.
   * Params are already validated at CLI boundary via Zod.
   */
  async execute(params: LinksRunHandlerParams): Promise<Result<LinksRunResult, Error>> {
    try {
      // Fetch all transactions
      this.eventBus?.emit({ type: 'load.started' });

      const transactionsResult = await this.transactionRepository.getTransactions();
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const transactions = transactionsResult.value;
      logger.info({ transactionCount: transactions.length }, 'Fetched transactions for linking');

      if (transactions.length === 0) {
        // Emit load completed with zero counts
        this.eventBus?.emit({
          type: 'load.completed',
          totalTransactions: 0,
          sourceCount: 0,
          targetCount: 0,
        });

        logger.warn('No transactions found to link');
        return ok({
          internalLinksCount: 0,
          confirmedLinksCount: 0,
          suggestedLinksCount: 0,
          totalSourceTransactions: 0,
          totalTargetTransactions: 0,
          unmatchedSourceCount: 0,
          unmatchedTargetCount: 0,
          dryRun: params.dryRun,
        });
      }

      let existingLinksCleared: number | undefined;
      if (!params.dryRun) {
        const existingCountResult = await this.linkRepository.count();
        if (existingCountResult.isOk()) {
          const existingCount = existingCountResult.value;
          if (existingCount > 0) {
            const deleteResult = await this.linkRepository.deleteAll();
            if (deleteResult.isErr()) {
              return err(deleteResult.error);
            }
            existingLinksCleared = existingCount;
            logger.info({ count: existingCount }, 'Cleared existing links');
            this.eventBus?.emit({ type: 'existing.cleared', count: existingCount });
          }
        }
      }

      // Create linking service with custom config
      const linkingService = new TransactionLinkingService(logger, {
        maxTimingWindowHours: 48, // Default 2 days
        minAmountSimilarity: DEFAULT_MATCHING_CONFIG.minAmountSimilarity,
        minConfidenceScore: params.minConfidenceScore,
        autoConfirmThreshold: params.autoConfirmThreshold,
      });

      // Run linking algorithm
      this.eventBus?.emit({ type: 'match.started' });

      const linkingResult = linkingService.linkTransactions(transactions);
      if (linkingResult.isErr()) {
        return err(linkingResult.error);
      }

      const {
        confirmedLinks,
        suggestedLinks,
        totalSourceTransactions,
        totalTargetTransactions,
        unmatchedSourceCount,
        unmatchedTargetCount,
      } = linkingResult.value;

      // Emit load completed now that we have source/target counts from linking service
      this.eventBus?.emit({
        type: 'load.completed',
        totalTransactions: transactions.length,
        sourceCount: totalSourceTransactions,
        targetCount: totalTargetTransactions,
      });

      logger.info(
        {
          confirmed: confirmedLinks.length,
          suggested: suggestedLinks.length,
          unmatchedSources: unmatchedSourceCount,
          unmatchedTargets: unmatchedTargetCount,
        },
        'Transaction linking completed'
      );

      // Build all link entities before applying overrides
      const now = new Date();
      const allLinks: TransactionLink[] = [...confirmedLinks];

      if (suggestedLinks.length > 0) {
        for (const match of suggestedLinks) {
          const linkResult = createTransactionLink(match, 'suggested', uuidv4(), now);
          if (linkResult.isErr()) {
            logger.warn({ error: linkResult.error.message, match }, 'Failed to create suggested link - skipping');
            continue;
          }
          allLinks.push(linkResult.value);
        }
      }

      // Count internal links discovered by the matching algorithm (before override replay)
      const internalLinks = allLinks.filter((l) => l.linkType === 'blockchain_internal');

      // Apply override events (confirm/reject) on top of algorithm results for all links
      const finalLinks = await this.applyOverrides(allLinks, transactions);

      // Count final results by status
      const adjustedConfirmed = finalLinks.filter(
        (l) => l.status === 'confirmed' && l.linkType !== 'blockchain_internal'
      );
      const adjustedSuggested = finalLinks.filter((l) => l.status === 'suggested');
      const internalLinksCount = internalLinks.length;

      // Emit match completed
      this.eventBus?.emit({
        type: 'match.completed',
        internalCount: internalLinksCount,
        confirmedCount: adjustedConfirmed.length,
        suggestedCount: adjustedSuggested.length,
      });

      // Rejected links are excluded from saving

      let totalSaved: number | undefined;
      if (!params.dryRun) {
        const linksToSave = finalLinks.filter((l) => l.status !== 'rejected');

        if (linksToSave.length > 0) {
          this.eventBus?.emit({ type: 'save.started' });

          const saveResult = await this.linkRepository.createBulk(linksToSave);
          if (saveResult.isErr()) {
            return err(saveResult.error);
          }
          totalSaved = saveResult.value;
          logger.info({ count: saveResult.value }, 'Saved links to database');

          this.eventBus?.emit({ type: 'save.completed', totalSaved: saveResult.value });
        }
      } else {
        logger.info('Dry run mode - no links saved to database');
      }

      return ok({
        existingLinksCleared,
        internalLinksCount,
        confirmedLinksCount: adjustedConfirmed.length,
        suggestedLinksCount: adjustedSuggested.length,
        totalSourceTransactions,
        totalTargetTransactions,
        unmatchedSourceCount,
        unmatchedTargetCount,
        totalSaved,
        dryRun: params.dryRun,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Apply link/unlink override events on top of algorithm-generated links.
   * If no override store is configured, returns the links unchanged.
   *
   * When a link_override references transactions that exist but the algorithm
   * didn't produce a matching link, a new confirmed link is created so the
   * user's decision survives reprocessing.
   */
  private async applyOverrides(
    links: TransactionLink[],
    transactions: UniversalTransactionData[]
  ): Promise<TransactionLink[]> {
    if (!this.overrideStore) return links;

    try {
      const overridesResult = await this.overrideStore.readAll();
      if (overridesResult.isErr()) {
        logger.warn({ error: overridesResult.error }, 'Failed to read override events, skipping replay');
        return links;
      }

      const overrides = overridesResult.value;
      const linkOverrides = overrides.filter((o) => o.scope === 'link' || o.scope === 'unlink');

      if (linkOverrides.length === 0) return links;

      logger.info({ count: linkOverrides.length }, 'Applying link override events');

      const result = applyLinkOverrides(links, linkOverrides, transactions);
      if (result.isErr()) {
        logger.warn({ error: result.error }, 'Failed to apply link overrides, using algorithm results');
        return links;
      }

      const { links: adjustedLinks, orphaned, unresolved } = result.value;

      // adjustedLinks is LinkWithStatus[] but contains full TransactionLink objects
      // Cast back to TransactionLink[] since we passed in TransactionLink[] and the
      // function only modifies status-related fields
      const typedLinks = adjustedLinks as TransactionLink[];

      // Create new confirmed links for orphaned overrides (algorithm didn't rediscover the pair)
      for (const entry of orphaned) {
        const linkResult = this.buildLinkFromOrphanedOverride(entry, transactions);
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
        typedLinks.push(linkResult.value);
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

      return typedLinks;
    } catch (error) {
      logger.warn({ error }, 'Unexpected error applying overrides, using algorithm results');
      return links;
    }
  }

  /**
   * Build a minimal TransactionLink from an orphaned override.
   *
   * An orphaned override occurs when the user confirmed a link between two transactions,
   * but the algorithm didn't rediscover that link during reprocessing (e.g., due to
   * timing or amount differences). We still honor the user's decision by creating a
   * confirmed link.
   *
   * Since the algorithm didn't match these transactions, we don't have computed amounts
   * or similarity scores. We use sentinel values to indicate this is a user override:
   *
   * Sentinel values (and why they're acceptable):
   * - sourceAmount/targetAmount: 0 (actual amounts unknown - link is user-created, not algorithm-matched)
   * - amountSimilarity: 0 (similarity not computed for user overrides)
   * - timingHours: 0 (timing not validated for user overrides)
   * - confidenceScore: 1.0 (user confirmation = highest confidence)
   * - assetMatch: true (asset is known from the override event)
   * - timingValid: true (we trust the user's judgment)
   *
   * The metadata.overrideId field links this back to the original override event.
   */
  private buildLinkFromOrphanedOverride(
    entry: OrphanedLinkOverride,
    transactions: UniversalTransactionData[]
  ): Result<TransactionLink, Error> {
    const now = new Date();
    const zero = parseDecimal('0');

    // Look up actual assetId from source and target transactions
    const sourceTx = transactions.find((tx) => tx.id === entry.sourceTransactionId);
    const targetTx = transactions.find((tx) => tx.id === entry.targetTransactionId);

    const sourceAssetIdResult = this.resolveUniqueAssetId(sourceTx, entry.sourceTransactionId, entry.assetSymbol, [
      'outflows',
      'inflows',
    ]);
    const targetAssetIdResult = this.resolveUniqueAssetId(targetTx, entry.targetTransactionId, entry.assetSymbol, [
      'inflows',
      'outflows',
    ]);

    if (sourceAssetIdResult.isErr() || targetAssetIdResult.isErr()) {
      const sourceContext = sourceAssetIdResult.isOk() ? sourceAssetIdResult.value : sourceAssetIdResult.error.message;
      const targetContext = targetAssetIdResult.isOk() ? targetAssetIdResult.value : targetAssetIdResult.error.message;

      return err(
        new Error(
          `Cannot resolve assetId for ${entry.assetSymbol}: ` + `source=${sourceContext}, ` + `target=${targetContext}.`
        )
      );
    }

    const sourceAssetId = sourceAssetIdResult.value;
    const targetAssetId = targetAssetIdResult.value;

    return ok({
      id: uuidv4(),
      sourceTransactionId: entry.sourceTransactionId,
      targetTransactionId: entry.targetTransactionId,
      assetSymbol: entry.assetSymbol,
      sourceAssetId,
      targetAssetId,
      sourceAmount: zero, // Sentinel: unknown (user override, not algorithm match)
      targetAmount: zero, // Sentinel: unknown (user override, not algorithm match)
      linkType: entry.linkType as TransactionLink['linkType'],
      confidenceScore: parseDecimal('1'), // User confirmation = highest confidence
      matchCriteria: {
        assetMatch: true, // Known from override event
        amountSimilarity: zero, // Sentinel: not computed for user overrides
        timingValid: true, // Trust user's judgment
        timingHours: 0, // Sentinel: not validated for user overrides
      },
      status: 'confirmed',
      reviewedBy: entry.override.actor,
      reviewedAt: new Date(entry.override.created_at),
      createdAt: now,
      updatedAt: now,
      metadata: { overrideId: entry.override.id },
    });
  }

  /**
   * Resolve a unique assetId for an asset symbol within a transaction.
   * Returns an error if there are no matching movements or multiple assetIds.
   */
  private resolveUniqueAssetId(
    tx: UniversalTransactionData | undefined,
    transactionId: number,
    assetSymbol: string,
    movementPriority: ('inflows' | 'outflows')[]
  ): Result<string, Error> {
    if (!tx) {
      return err(new Error(`tx ${transactionId} not found`));
    }

    const candidates: string[] = [];
    for (const direction of movementPriority) {
      const movements = tx.movements[direction] ?? [];
      for (const movement of movements) {
        if (movement.assetSymbol === assetSymbol) {
          candidates.push(movement.assetId);
        }
      }
    }

    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 0) {
      return err(new Error(`tx ${transactionId} has no ${assetSymbol} movements`));
    }

    if (uniqueCandidates.length > 1) {
      return err(
        new Error(`tx ${transactionId} has ambiguous ${assetSymbol} assetIds: ${uniqueCandidates.join(', ')}`)
      );
    }

    return ok(uniqueCandidates[0]!);
  }
}
