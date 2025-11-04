import type { UniversalTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { getLogger } from '@exitbook/shared-logger';
import { ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import {
  convertToCandidates,
  createTransactionLink,
  deduplicateAndConfirm,
  DEFAULT_MATCHING_CONFIG,
  findPotentialMatches,
  separateSourcesAndTargets,
  validateLinkAmounts,
} from './matching-utils.js';
import type { LinkingResult, MatchingConfig, PotentialMatch, TransactionLink } from './types.js';

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

      // Convert to candidates (pure function)
      const candidates = convertToCandidates(transactions);
      this.logger.debug({ candidateCount: candidates.length }, 'Converted transactions to candidates');

      // Separate into sources (withdrawals) and targets (deposits) (pure function)
      const { sources, targets } = separateSourcesAndTargets(candidates);
      this.logger.info({ sourceCount: sources.length, targetCount: targets.length }, 'Separated sources and targets');

      // Find matches (pure function)
      const allMatches: PotentialMatch[] = [];
      for (const source of sources) {
        const matches = findPotentialMatches(source, targets, this.config);
        allMatches.push(...matches);
      }

      this.logger.info({ matchCount: allMatches.length }, 'Found potential matches');

      // Deduplicate matches (pure function)
      const { suggested, confirmed } = deduplicateAndConfirm(allMatches, this.config);

      // Convert to TransactionLink objects with validation (pure function with injected UUID/timestamp)
      const now = new Date();
      const confirmedLinks: TransactionLink[] = [];
      const successfulConfirmedMatches: PotentialMatch[] = [];
      let filteredConfirmedCount = 0;
      for (const match of confirmed) {
        const linkResult = createTransactionLink(match, 'confirmed', uuidv4(), now);
        if (linkResult.isErr()) {
          this.logger.warn(
            { error: linkResult.error.message, match },
            'Failed to create confirmed link due to validation error - skipping'
          );
          filteredConfirmedCount++;
          continue;
        }
        confirmedLinks.push(linkResult.value);
        successfulConfirmedMatches.push(match);
      }
      if (filteredConfirmedCount > 0) {
        this.logger.info(
          {
            filteredCount: filteredConfirmedCount,
            totalConfirmed: confirmed.length,
            validConfirmed: confirmedLinks.length,
          },
          `Filtered out ${filteredConfirmedCount} confirmed matches due to validation errors`
        );
      }

      // Validate suggested matches (but don't fail - just filter out invalid ones)
      const validSuggested: PotentialMatch[] = [];
      let filteredSuggestedCount = 0;
      for (const match of suggested) {
        const validationResult = validateLinkAmounts(match.sourceTransaction.amount, match.targetTransaction.amount);
        if (validationResult.isErr()) {
          this.logger.debug({ error: validationResult.error.message, match }, 'Filtered out invalid suggested match');
          filteredSuggestedCount++;
          continue;
        }
        validSuggested.push(match);
      }
      if (filteredSuggestedCount > 0) {
        this.logger.info(
          {
            filteredCount: filteredSuggestedCount,
            totalSuggested: suggested.length,
            validSuggested: validSuggested.length,
          },
          `Filtered out ${filteredSuggestedCount} invalid suggested matches due to amount validation`
        );
      }
      const suggestedLinks = validSuggested;

      // Calculate statistics from filtered matches only
      const linkedMatches = [...successfulConfirmedMatches, ...validSuggested];
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
      this.logger.error({ error }, 'Failed to link transactions');
      return wrapError(error, 'Transaction linking failed');
    }
  }
}
