import type { UniversalTransaction } from '@exitbook/core';
import { computePrimaryMovement } from '@exitbook/core';
import type { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import { DEFAULT_MATCHING_CONFIG, findPotentialMatches, shouldAutoConfirm } from './matching-utils.js';
import type { LinkingResult, MatchingConfig, PotentialMatch, TransactionCandidate, TransactionLink } from './types.js';

/**
 * Service for linking related transactions (e.g., exchange withdrawals → blockchain deposits)
 */
export class TransactionLinkingService {
  constructor(
    private readonly logger: ReturnType<typeof getLogger>,
    private readonly config: MatchingConfig = DEFAULT_MATCHING_CONFIG
  ) {}

  /**
   * Link transactions by finding matches between withdrawals and deposits
   *
   * @param transactions - All transactions to analyze
   * @returns Linking result with suggested and confirmed links
   */
  linkTransactions(transactions: UniversalTransaction[]): Result<LinkingResult, Error> {
    try {
      this.logger.info({ transactionCount: transactions.length }, 'Starting transaction linking process');

      // Convert to candidates
      const candidates = this.convertToCandidates(transactions);
      this.logger.debug({ candidateCount: candidates.length }, 'Converted transactions to candidates');

      // Separate into sources (withdrawals) and targets (deposits)
      const { sources, targets } = this.separateSourcesAndTargets(candidates);
      this.logger.info({ sourceCount: sources.length, targetCount: targets.length }, 'Separated sources and targets');

      // Find matches
      const allMatches: PotentialMatch[] = [];
      for (const source of sources) {
        const matches = findPotentialMatches(source, targets, this.config);
        allMatches.push(...matches);
      }

      this.logger.info({ matchCount: allMatches.length }, 'Found potential matches');

      // Deduplicate matches (one target can only match one source)
      const { suggested, confirmed } = this.deduplicateAndConfirm(allMatches);

      // Convert to TransactionLink objects
      const confirmedLinks = confirmed.map((match) => this.createTransactionLink(match, 'confirmed'));
      const suggestedLinks = suggested; // Keep as PotentialMatch for now

      // Calculate statistics
      const linkedMatches = [...confirmed, ...suggested];
      const matchedSourceIds = new Set(linkedMatches.map((match) => match.sourceTransaction.id));
      const matchedTargetIds = new Set(linkedMatches.map((match) => match.targetTransaction.id));

      const result: LinkingResult = {
        suggestedLinks,
        confirmedLinks,
        totalSourceTransactions: sources.length,
        totalTargetTransactions: targets.length,
        matchedTransactionCount: matchedSourceIds.size + matchedTargetIds.size,
        unmatchedSourceCount: sources.length - matchedSourceIds.size,
        unmatchedTargetCount: targets.length - matchedTargetIds.size,
      };

      this.logger.info(
        {
          suggested: suggestedLinks.length,
          confirmed: confirmedLinks.length,
          unmatched: result.unmatchedSourceCount + result.unmatchedTargetCount,
        },
        'Transaction linking completed'
      );

      return ok(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error }, 'Failed to link transactions');
      return err(new Error(`Transaction linking failed: ${message}`));
    }
  }

  /**
   * Convert stored transactions to transaction candidates for matching
   */
  private convertToCandidates(transactions: UniversalTransaction[]): TransactionCandidate[] {
    const candidates: TransactionCandidate[] = [];

    for (const tx of transactions) {
      // Compute primary movement from already-deserialized movements
      const primary = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);

      // Skip if no primary movement
      if (!primary) {
        continue;
      }

      const candidate: TransactionCandidate = {
        id: tx.id,
        externalId: tx.uniqueId,
        sourceId: tx.source,
        sourceType: tx.blockchain ? 'blockchain' : 'exchange',
        timestamp: new Date(tx.datetime),
        asset: primary.asset,
        amount: primary.amount,
        direction: primary.direction,
        fromAddress: tx.from,
        toAddress: tx.to,
      };

      candidates.push(candidate);
    }

    return candidates;
  }

  /**
   * Separate candidates into sources (outflows) and targets (inflows)
   */
  private separateSourcesAndTargets(candidates: TransactionCandidate[]): {
    sources: TransactionCandidate[];
    targets: TransactionCandidate[];
  } {
    const sources: TransactionCandidate[] = [];
    const targets: TransactionCandidate[] = [];

    for (const candidate of candidates) {
      // Only consider specific operation types for linking
      // Sources: withdrawals, sends
      // Targets: deposits, receives

      if (candidate.direction === 'out') {
        sources.push(candidate);
      } else if (candidate.direction === 'in') {
        targets.push(candidate);
      }
    }

    return { sources, targets };
  }

  /**
   * Deduplicate matches and separate into confirmed vs suggested
   * - One target can only match one source (highest confidence wins)
   * - One source can only match one target (highest confidence wins)
   * - Auto-confirm matches above threshold
   */
  private deduplicateAndConfirm(matches: PotentialMatch[]): {
    confirmed: PotentialMatch[];
    suggested: PotentialMatch[];
  } {
    // Sort all matches by confidence (highest first)
    const sortedMatches = [...matches].sort((a, b) => b.confidenceScore.comparedTo(a.confidenceScore));

    const usedSources = new Set<number>();
    const usedTargets = new Set<number>();
    const deduplicatedMatches: PotentialMatch[] = [];

    // Greedily select matches, ensuring each source and target is used at most once
    for (const match of sortedMatches) {
      const sourceId = match.sourceTransaction.id;
      const targetId = match.targetTransaction.id;

      // Skip if either source or target is already used
      if (usedSources.has(sourceId) || usedTargets.has(targetId)) {
        continue;
      }

      // Accept this match
      deduplicatedMatches.push(match);
      usedSources.add(sourceId);
      usedTargets.add(targetId);
    }

    const suggested: PotentialMatch[] = [];
    const confirmed: PotentialMatch[] = [];

    // Separate into confirmed vs suggested based on confidence threshold
    for (const match of deduplicatedMatches) {
      if (shouldAutoConfirm(match, this.config)) {
        confirmed.push(match);
      } else {
        suggested.push(match);
      }
    }

    return { suggested, confirmed };
  }

  /**
   * Create a TransactionLink object from a potential match
   */
  private createTransactionLink(match: PotentialMatch, status: 'suggested' | 'confirmed'): TransactionLink {
    const now = new Date();

    return {
      id: uuidv4(),
      sourceTransactionId: match.sourceTransaction.id,
      targetTransactionId: match.targetTransaction.id,
      linkType: match.linkType,
      confidenceScore: match.confidenceScore,
      matchCriteria: match.matchCriteria,
      status,
      reviewedBy: status === 'confirmed' ? 'auto' : undefined,
      reviewedAt: status === 'confirmed' ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };
  }
}
