import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal, wrapError } from '@exitbook/core';
import type { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
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
  linkTransactions(transactions: UniversalTransactionData[]): Result<LinkingResult, Error> {
    try {
      this.logger.info({ transactionCount: transactions.length }, 'Starting transaction linking process');

      // Detect internal blockchain transfers (UTXO model - same tx_hash, different addresses)
      const internalLinksResult = this.detectInternalBlockchainTransfers(transactions);
      if (internalLinksResult.isErr()) {
        this.logger.warn({ error: internalLinksResult.error.message }, 'Failed to detect internal transfers');
      }
      const internalLinks = internalLinksResult.isOk() ? internalLinksResult.value : [];

      if (internalLinks.length > 0) {
        this.logger.info({ internalLinkCount: internalLinks.length }, 'Detected internal blockchain transfers');
      }

      // Convert to candidates
      const candidates = convertToCandidates(transactions);
      this.logger.debug({ candidateCount: candidates.length }, 'Converted transactions to candidates');

      // Separate into sources (withdrawals) and targets (deposits)
      const { sources, targets } = separateSourcesAndTargets(candidates);
      this.logger.info({ sourceCount: sources.length, targetCount: targets.length }, 'Separated sources and targets');

      // Find cross-source matches
      const allMatches: PotentialMatch[] = [];
      for (const source of sources) {
        const matches = findPotentialMatches(source, targets, this.config);
        allMatches.push(...matches);
      }

      this.logger.info({ matchCount: allMatches.length }, 'Found potential cross-source matches');

      // Deduplicate matches
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

      // Combine internal links with cross-source links
      const allConfirmedLinks = [...confirmedLinks, ...internalLinks];

      // Calculate statistics from filtered matches only
      const linkedMatches = [...successfulConfirmedMatches, ...validSuggested];
      const matchedSourceIds = new Set(linkedMatches.map((match) => match.sourceTransaction.id));
      const matchedTargetIds = new Set(linkedMatches.map((match) => match.targetTransaction.id));

      // Include internal links in matched counts
      for (const link of internalLinks) {
        matchedSourceIds.add(link.sourceTransactionId);
        matchedTargetIds.add(link.targetTransactionId);
      }

      const result: LinkingResult = {
        suggestedLinks,
        confirmedLinks: allConfirmedLinks,
        totalSourceTransactions: sources.length,
        totalTargetTransactions: targets.length,
        matchedTransactionCount: matchedSourceIds.size + matchedTargetIds.size,
        unmatchedSourceCount: sources.length - matchedSourceIds.size,
        unmatchedTargetCount: targets.length - matchedTargetIds.size,
      };

      this.logger.info(
        {
          suggested: suggestedLinks.length,
          confirmed: allConfirmedLinks.length,
          internal: internalLinks.length,
          crossSource: confirmedLinks.length,
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

  /**
   * Normalizes a blockchain transaction hash by removing log index suffix.
   * Some providers (e.g., Moralis) append `-{logIndex}` to differentiate token transfers
   * within the same transaction, while others (e.g., Routescan) don't provide log index.
   *
   * Examples:
   * - 0xabc123-819 → 0xabc123
   * - 0xabc123 → 0xabc123
   *
   * @param txHash - Transaction hash, potentially with log index suffix
   * @returns Normalized transaction hash without suffix
   */
  private normalizeTransactionHash(txHash: string): string {
    // Strip -<number> suffix if present (log index from Moralis, etc.)
    return txHash.replace(/-\d+$/, '');
  }

  /**
   * Detect internal blockchain transfers (UTXO model)
   * Links transactions with the same blockchain_transaction_hash across different accounts
   *
   * Example: Bitcoin tx touching 2 addresses creates:
   *  - Account 2: 0.01916264 BTC outflow (tx_hash: abc123)
   *  - Account 13: 0.00301222 BTC inflow (tx_hash: abc123)
   * These are linked as views of the same on-chain transaction.
   *
   * Note: Transaction hashes are normalized to handle provider inconsistencies:
   * - Moralis appends log index (e.g., 0xabc-819 for token transfers)
   * - Routescan/Alchemy use base hash only
   * Both will group together as the same on-chain transaction.
   *
   * @param transactions - All transactions to analyze
   * @returns Array of internal transfer links (always confirmed, 100% confidence)
   */
  private detectInternalBlockchainTransfers(
    transactions: UniversalTransactionData[]
  ): Result<TransactionLink[], Error> {
    try {
      // Group by normalized blockchain_transaction_hash (strip log index suffix)
      const txHashGroups = new Map<string, UniversalTransactionData[]>();

      for (const tx of transactions) {
        // Only consider blockchain transactions with a hash
        if (!tx.blockchain?.transaction_hash) continue;

        // Skip transactions with no movements (e.g., contract interactions with zero value)
        // These don't represent actual value transfers and shouldn't be linked
        const hasMovements =
          (tx.movements.inflows && tx.movements.inflows.length > 0) ||
          (tx.movements.outflows && tx.movements.outflows.length > 0);

        if (!hasMovements) {
          this.logger.debug(
            { txId: tx.id, txHash: tx.blockchain.transaction_hash },
            'Skipping transaction with no movements from internal linking'
          );
          continue;
        }

        // Normalize hash to handle cross-provider linking (strip -logIndex suffix)
        const normalizedHash = this.normalizeTransactionHash(tx.blockchain.transaction_hash);
        const group = txHashGroups.get(normalizedHash) ?? [];
        group.push(tx);
        txHashGroups.set(normalizedHash, group);
      }

      const links: TransactionLink[] = [];
      const now = new Date();

      // Create links for groups with multiple transactions from different accounts
      for (const [normalizedHash, group] of txHashGroups) {
        if (group.length < 2) continue;

        // Group transactions by account_id to avoid linking the same account to itself
        const accountIds = new Set(group.map((tx) => tx.accountId));

        // Skip if all transactions are from the same account (shouldn't happen with UTXO model, but safety check)
        if (accountIds.size < 2) continue;

        // Create full mesh of links between all pairs from different accounts
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const tx1 = group[i];
            const tx2 = group[j];

            // Type guard - should never happen but TypeScript needs it
            if (!tx1 || !tx2) continue;

            // Skip if same account
            if (tx1.accountId === tx2.accountId) continue;

            // Extract asset and amounts from movements
            const asset1 = this.extractPrimaryAsset(tx1);
            const asset2 = this.extractPrimaryAsset(tx2);

            if (!asset1 || !asset2 || asset1 !== asset2) {
              this.logger.warn(
                { normalizedHash, tx1Id: tx1.id, tx2Id: tx2.id, asset1, asset2 },
                'Skipping internal link - cannot extract matching asset from both transactions'
              );
              continue;
            }

            const amount1 = this.extractPrimaryAmount(tx1);
            const amount2 = this.extractPrimaryAmount(tx2);

            if (!amount1 || !amount2) {
              this.logger.warn(
                { normalizedHash, tx1Id: tx1.id, tx2Id: tx2.id },
                'Skipping internal link - cannot extract amounts from both transactions'
              );
              continue;
            }

            links.push({
              id: uuidv4(),
              sourceTransactionId: tx1.id,
              targetTransactionId: tx2.id,
              assetSymbol: asset1,
              sourceAmount: amount1,
              targetAmount: amount2,
              linkType: 'blockchain_internal',
              confidenceScore: parseDecimal('1.0'), // Perfect match (same tx_hash)
              matchCriteria: {
                assetMatch: true,
                amountSimilarity: parseDecimal('1.0'),
                timingValid: true,
                timingHours: 0,
                addressMatch: undefined, // Not applicable for internal transfers
              },
              status: 'confirmed',
              reviewedBy: 'auto',
              reviewedAt: now,
              createdAt: now,
              updatedAt: now,
              metadata: {
                blockchainTxHash: normalizedHash,
                blockchain: tx1.blockchain?.name,
              },
            });
          }
        }
      }

      return ok(links);
    } catch (error) {
      return wrapError(error, 'Failed to detect internal blockchain transfers');
    }
  }

  /**
   * Extract primary asset from transaction movements
   * Prefers outflows, then inflows
   */
  private extractPrimaryAsset(tx: UniversalTransactionData): string | undefined {
    const outflows = tx.movements.outflows ?? [];
    const inflows = tx.movements.inflows ?? [];

    if (outflows.length > 0 && outflows[0]) return outflows[0].assetSymbol;
    if (inflows.length > 0 && inflows[0]) return inflows[0].assetSymbol;

    return;
  }

  /**
   * Extract primary amount from transaction movements
   * Prefers outflows (gross), then inflows (gross)
   */
  private extractPrimaryAmount(tx: UniversalTransactionData): Decimal | undefined {
    const outflows = tx.movements.outflows ?? [];
    const inflows = tx.movements.inflows ?? [];

    if (outflows.length > 0 && outflows[0]) return outflows[0].grossAmount;
    if (inflows.length > 0 && inflows[0]) return inflows[0].grossAmount;

    return;
  }
}
