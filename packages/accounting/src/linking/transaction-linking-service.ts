import { type UniversalTransactionData, parseDecimal, wrapError } from '@exitbook/core';
import type { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import {
  aggregateMovementsByTransaction,
  calculateOutflowAdjustment,
  convertToCandidates,
  createTransactionLink,
  deduplicateAndConfirm,
  DEFAULT_MATCHING_CONFIG,
  findPotentialMatches,
  separateSourcesAndTargets,
} from './matching-utils.js';
import type { LinkingResult, MatchingConfig, OutflowGrouping, PotentialMatch, TransactionLink } from './types.js';

const UTXO_CHAIN_NAMES = new Set(['bitcoin', 'dogecoin', 'litecoin', 'bitcoin-cash', 'cardano']);

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

      // Build internal change adjustments based on blockchain_internal link clusters
      const { adjustments: internalOutflowAdjustments, outflowGroupings } = this.buildInternalOutflowAdjustments(
        transactions,
        internalLinks
      );
      if (internalOutflowAdjustments.size > 0) {
        this.logger.info(
          { adjustmentCount: internalOutflowAdjustments.size },
          'Computed internal change adjustments for blockchain outflows'
        );
      }

      // Convert to candidates
      if (outflowGroupings.length > 0) {
        this.logger.info(
          `Creating candidates with ${outflowGroupings.length} outflow groupings: ` +
            outflowGroupings
              .map((g) => `${g.assetId} [${Array.from(g.groupMemberIds).join(', ')}] rep=${g.representativeTxId}`)
              .join('; ')
        );
      }
      const candidates = convertToCandidates(transactions, internalOutflowAdjustments, outflowGroupings);
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
      const validSuggestedMatches: PotentialMatch[] = [];
      let filteredConfirmedCount = 0;
      for (const match of confirmed) {
        const linkResult = createTransactionLink(match, 'confirmed', uuidv4(), now);
        if (linkResult.isErr()) {
          this.logger.warn(
            `Failed to create confirmed link due to validation error - skipping | ` +
              `Error: ${linkResult.error.message} | ` +
              `Source TX: ${match.sourceTransaction.id} | ` +
              `Target TX: ${match.targetTransaction.id} | ` +
              `Asset: ${match.sourceTransaction.assetSymbol} | ` +
              `Source Amount: ${match.sourceTransaction.amount.toFixed()} | ` +
              `Target Amount: ${match.targetTransaction.amount.toFixed()} | ` +
              `Link Type: ${match.linkType} | ` +
              `Confidence: ${match.confidenceScore.toFixed()}`
          );
          filteredConfirmedCount++;
          continue;
        }
        if (linkResult.value.metadata?.['targetExcessAllowed'] === true) {
          this.logger.warn(
            {
              sourceTxId: linkResult.value.sourceTransactionId,
              targetTxId: linkResult.value.targetTransactionId,
              assetSymbol: linkResult.value.assetSymbol,
              sourceAmount: linkResult.value.sourceAmount.toFixed(),
              targetAmount: linkResult.value.targetAmount.toFixed(),
              targetExcess: linkResult.value.metadata?.['targetExcess'],
              targetExcessPct: linkResult.value.metadata?.['targetExcessPct'],
            },
            'Allowed hash-match link where target exceeds source within tolerance (UTXO partial inputs)'
          );
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

      // Convert suggested matches to TransactionLink objects with validation
      const suggestedLinks: TransactionLink[] = [];
      let filteredSuggestedCount = 0;
      for (const match of suggested) {
        const linkResult = createTransactionLink(match, 'suggested', uuidv4(), now);
        if (linkResult.isErr()) {
          this.logger.debug({ error: linkResult.error.message, match }, 'Filtered out invalid suggested match');
          filteredSuggestedCount++;
          continue;
        }
        if (linkResult.value.metadata?.['targetExcessAllowed'] === true) {
          this.logger.warn(
            {
              sourceTxId: linkResult.value.sourceTransactionId,
              targetTxId: linkResult.value.targetTransactionId,
              assetSymbol: linkResult.value.assetSymbol,
              sourceAmount: linkResult.value.sourceAmount.toFixed(),
              targetAmount: linkResult.value.targetAmount.toFixed(),
              targetExcess: linkResult.value.metadata?.['targetExcess'],
              targetExcessPct: linkResult.value.metadata?.['targetExcessPct'],
            },
            'Allowed hash-match suggested link where target exceeds source within tolerance (UTXO partial inputs)'
          );
        }
        suggestedLinks.push(linkResult.value);
        validSuggestedMatches.push(match);
      }
      if (filteredSuggestedCount > 0) {
        this.logger.info(
          {
            filteredCount: filteredSuggestedCount,
            totalSuggested: suggested.length,
            validSuggested: suggestedLinks.length,
          },
          `Filtered out ${filteredSuggestedCount} invalid suggested matches due to amount validation`
        );
      }

      // Combine internal links with cross-source links
      const allConfirmedLinks = [...confirmedLinks, ...internalLinks];

      // Calculate statistics from filtered matches only
      const linkedMatches = [...successfulConfirmedMatches, ...validSuggestedMatches];
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
        // Only consider UTXO blockchain transactions with a hash
        const blockchainName = tx.blockchain?.name;
        if (!blockchainName || !tx.blockchain?.transaction_hash) continue;
        if (tx.sourceType !== 'blockchain') continue;
        if (!UTXO_CHAIN_NAMES.has(blockchainName)) continue;

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

            // Extract primary movement from each transaction
            const movement1 = this.extractPrimaryMovement(tx1);
            const movement2 = this.extractPrimaryMovement(tx2);

            if (!movement1 || !movement2 || movement1.assetSymbol !== movement2.assetSymbol) {
              this.logger.warn(
                {
                  normalizedHash,
                  tx1Id: tx1.id,
                  tx2Id: tx2.id,
                  asset1: movement1?.assetSymbol,
                  asset2: movement2?.assetSymbol,
                },
                'Skipping internal link - cannot extract matching asset from both transactions'
              );
              continue;
            }

            links.push({
              id: uuidv4(),
              sourceTransactionId: tx1.id,
              targetTransactionId: tx2.id,
              assetSymbol: movement1.assetSymbol,
              sourceAssetId: movement1.assetId,
              targetAssetId: movement2.assetId,
              sourceAmount: movement1.grossAmount,
              targetAmount: movement2.grossAmount,
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
   * Build adjusted outflow amounts using blockchain_internal link clusters.
   *
   * When a cluster contains both outflows and inflows for the same asset, subtract
   * the internal inflow amounts from the outflow to approximate the external transfer
   * amount for matching.
   *
   * Important: Only adjusts assets that have blockchain_internal links in the cluster.
   * This prevents incorrectly adjusting unrelated assets (e.g., fees) in multi-asset
   * transactions.
   *
   * @param transactions - All transactions to analyze
   * @param internalLinks - blockchain_internal links for grouping
   * @returns Adjustments map and outflow groupings for UTXO transactions
   */
  private buildInternalOutflowAdjustments(
    transactions: UniversalTransactionData[],
    internalLinks: TransactionLink[]
  ): { adjustments: Map<number, Map<string, Decimal>>; outflowGroupings: OutflowGrouping[] } {
    const adjustments = new Map<number, Map<string, Decimal>>();
    const outflowGroupings: OutflowGrouping[] = [];
    let nonPositiveCount = 0;
    let adjustmentCount = 0;

    if (internalLinks.length === 0) {
      return { adjustments, outflowGroupings };
    }

    const transactionsById = new Map<number, UniversalTransactionData>();
    for (const tx of transactions) {
      transactionsById.set(tx.id, tx);
    }

    // Build adjacency graph AND track which assets are linked per transaction
    const adjacency = new Map<number, Set<number>>();
    const linkedAssetsPerTx = new Map<number, Set<string>>();

    for (const link of internalLinks) {
      if (link.linkType !== 'blockchain_internal') continue;
      const sourceId = link.sourceTransactionId;
      const targetId = link.targetTransactionId;

      // Build adjacency for clustering
      if (!adjacency.has(sourceId)) adjacency.set(sourceId, new Set());
      if (!adjacency.has(targetId)) adjacency.set(targetId, new Set());
      adjacency.get(sourceId)?.add(targetId);
      adjacency.get(targetId)?.add(sourceId);

      // Track which assetIds are linked for each transaction
      if (!linkedAssetsPerTx.has(sourceId)) linkedAssetsPerTx.set(sourceId, new Set());
      if (!linkedAssetsPerTx.has(targetId)) linkedAssetsPerTx.set(targetId, new Set());
      linkedAssetsPerTx.get(sourceId)?.add(link.sourceAssetId);
      linkedAssetsPerTx.get(targetId)?.add(link.targetAssetId);
    }

    // Find connected components (clusters) and merge linked assets
    const visited = new Set<number>();
    const clusters: { linkedAssets: Set<string>; txs: UniversalTransactionData[] }[] = [];

    for (const txId of adjacency.keys()) {
      if (visited.has(txId)) continue;
      const stack = [txId];
      const cluster: UniversalTransactionData[] = [];
      const linkedAssets = new Set<string>();
      visited.add(txId);

      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) continue;
        const tx = transactionsById.get(current);
        if (tx) cluster.push(tx);

        // Merge linked assets for this transaction into cluster
        const assetsForTx = linkedAssetsPerTx.get(current);
        if (assetsForTx) {
          for (const asset of assetsForTx) {
            linkedAssets.add(asset);
          }
        }

        const neighbors = adjacency.get(current);
        if (!neighbors) continue;
        for (const neighbor of neighbors) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }

      if (cluster.length > 1) {
        clusters.push({ txs: cluster, linkedAssets });
      }
    }

    // Calculate adjustments only for assets that have blockchain_internal links
    for (const { txs: group, linkedAssets } of clusters) {
      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);

      // Only process assets that are actually linked in this cluster
      // This prevents adjusting unrelated assets (e.g., fees in multi-asset transactions)
      for (const assetId of linkedAssets) {
        const result = calculateOutflowAdjustment(assetId, group, inflowAmountsByTx, outflowAmountsByTx);

        if ('skip' in result) {
          if (result.skip === 'non-positive') {
            nonPositiveCount++;
            this.logger.debug({ assetId }, 'Skipping internal outflow adjustment: adjusted amount is non-positive');
          }
          continue;
        }

        // Info when multiple outflows exist - UTXO transaction with multiple inputs
        if (result.multipleOutflows) {
          this.logger.info(
            `Multiple outflows detected for ${assetId} - summed all outflows and subtracted change | ` +
              `Representative TX: ${result.representativeTxId} | ` +
              `Group Members: [${result.groupMemberIds.join(', ')}] | ` +
              `Adjusted Amount: ${result.adjustedAmount.toFixed()}`
          );

          // Track this grouping so we can filter out non-representative members during candidate creation
          outflowGroupings.push({
            representativeTxId: result.representativeTxId,
            groupMemberIds: new Set(result.groupMemberIds),
            assetId,
          });
        }

        const byAsset = adjustments.get(result.representativeTxId) ?? new Map<string, Decimal>();
        byAsset.set(assetId, result.adjustedAmount);
        adjustments.set(result.representativeTxId, byAsset);
        adjustmentCount++;
      }
    }

    if (nonPositiveCount > 0) {
      this.logger.info({ adjustmentCount, nonPositiveCount }, 'Internal outflow adjustment summary');
    }

    return { adjustments, outflowGroupings };
  }

  /**
   * Extract the primary movement from a transaction.
   * Prefers outflows, then inflows. Returns undefined if no movements exist.
   */
  private extractPrimaryMovement(tx: UniversalTransactionData) {
    return (tx.movements.outflows ?? [])[0] ?? (tx.movements.inflows ?? [])[0];
  }
}
