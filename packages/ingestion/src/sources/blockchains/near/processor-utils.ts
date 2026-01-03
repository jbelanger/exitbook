/**
 * NEAR Processor Utilities
 *
 * Pure utility functions for processing NEAR transactions in architecture:
 * - Group normalized data by transaction hash
 * - Two-hop correlation: receipts → transactions, activities → receipts
 *   (token transfers are handled at transaction level)
 * - Handle NEAR's two-phase balance change model:
 *   • TRANSACTION-LEVEL: Balance changes from transaction acceptance (gas prepayment, deposits)
 *     → Attached to transaction-level synthetic receipt (correct NEAR semantics)
 *   • RECEIPT-LEVEL: Balance changes from receipt execution (actual state changes)
 *     → Must correlate to specific receipts (fails fast if missing receipt_id)
 * - Extract fees with single source of truth
 * - Extract fund flows from receipts
 * - Aggregate movements by asset
 * - Classify operation types
 *
 * All functions are pure (no side effects) for easier testing.
 */

import type {
  NearBalanceChange,
  NearStreamEvent,
  NearTokenTransfer,
  NearBalanceChangeCause,
  NearActionType,
} from '@exitbook/blockchain-providers';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { CorrelatedTransaction, NearReceipt, RawTransactionGroup } from './types.js';

const logger = getLogger('near-processor-utils');

const NEAR_DECIMALS = 24;

// Fee mismatch threshold: Tolerance for differences between receipt tokensBurnt and balance change fees
// Set at 1% to catch significant discrepancies while allowing for rounding/timing differences
const FEE_MISMATCH_THRESHOLD_PERCENT = 1;

/**
 * Balance change causes categorized by their expected correlation level.
 *
 * NEAR's asynchronous architecture creates balance changes at two distinct lifecycle stages:
 *
 * 1. TRANSACTION-LEVEL: Balance changes that occur when a transaction is accepted by the network
 *    - These represent transaction initiation costs (gas prepayment, deposit reservation)
 *    - SHOULD have transaction_hash but NOT receipt_id (correct NEAR semantics)
 *    - Attached to transaction-level synthetic receipt (this is valid!)
 *
 * 2. RECEIPT-LEVEL: Balance changes that occur when a receipt executes
 *    - These represent execution outcomes (actual state changes, fund transfers)
 *    - MUST have receipt_id (may have transaction_hash = null for cross-contract calls)
 *    - Attached to specific receipt (required for correct accounting)
 *
 * 3. AMBIGUOUS: Causes that can appear at either level depending on context
 *    - Use receipt_id if present, otherwise fall back to transaction-level
 */
const TRANSACTION_LEVEL_CAUSES = new Set<NearBalanceChangeCause>(['TRANSACTION']);

const RECEIPT_LEVEL_CAUSES = new Set<NearBalanceChangeCause>(['RECEIPT', 'TRANSFER']);

const AMBIGUOUS_CAUSES = new Set<NearBalanceChangeCause>([
  'FEE',
  'GAS',
  'GAS_REFUND',
  'CONTRACT_REWARD',
  'MINT',
  'STAKE',
]);

const FEE_CAUSES = new Set<NearBalanceChangeCause>(['FEE', 'GAS', 'GAS_REFUND']);

function normalizeNearAmount(yoctoAmount: Decimal | string): Decimal {
  return new Decimal(yoctoAmount).dividedBy(new Decimal(10).pow(NEAR_DECIMALS));
}

function normalizeTokenAmount(rawAmount: Decimal | string, decimals: number): Decimal {
  return new Decimal(rawAmount).dividedBy(new Decimal(10).pow(decimals));
}

/**
 * Movement represents a fund flow (inflow or outflow) in a transaction
 */
export interface Movement {
  asset: string;
  amount: Decimal;
  contractAddress?: string | undefined;
  direction: 'in' | 'out';
  flowType: 'native' | 'token_transfer' | 'fee' | 'unknown';
}

export interface DerivedDeltaResult {
  derivedDeltas: Map<string, string>;
  warnings: string[];
}

function parseBlockHeight(blockHeight: string | undefined): number {
  if (!blockHeight) return 0;
  const parsed = parseInt(blockHeight, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Derive missing deltaAmount values for balance changes using absolute balances.
 *
 * Uses a single ordered stream per affected account to compute deltas:
 * delta = currentAbsolute - previousAbsolute
 *
 * If the first activity for an account is missing deltaAmount, we use the
 * prior balance from previousBalances when available. Otherwise we assume
 * a prior balance of 0 ONLY for INBOUND events (and warn). OUTBOUND events
 * without a prior balance remain unresolved.
 */
export function deriveBalanceChangeDeltasFromAbsolutes(
  balanceChanges: NearBalanceChange[],
  previousBalances = new Map<string, string>()
): DerivedDeltaResult {
  const derivedDeltas = new Map<string, string>();
  const warnings: string[] = [];

  const byAccount = new Map<string, NearBalanceChange[]>();
  for (const change of balanceChanges) {
    const existing = byAccount.get(change.affectedAccountId) || [];
    existing.push(change);
    byAccount.set(change.affectedAccountId, existing);
  }

  for (const [accountId, changes] of byAccount.entries()) {
    const ordered = [...changes].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      const heightA = parseBlockHeight(a.blockHeight);
      const heightB = parseBlockHeight(b.blockHeight);
      if (heightA !== heightB) {
        return heightA - heightB;
      }
      const hasReceiptA = a.receiptId !== undefined && a.receiptId !== null;
      const hasReceiptB = b.receiptId !== undefined && b.receiptId !== null;
      if (hasReceiptA !== hasReceiptB) {
        return hasReceiptA ? -1 : 1;
      }
      const receiptA = a.receiptId ?? '';
      const receiptB = b.receiptId ?? '';
      if (receiptA !== receiptB) {
        return receiptA.localeCompare(receiptB);
      }
      return (a.eventId ?? '').localeCompare(b.eventId ?? '');
    });

    let previousBalance: Decimal | undefined;
    const seededBalance = previousBalances.get(accountId);
    if (seededBalance !== undefined) {
      try {
        previousBalance = new Decimal(seededBalance);
      } catch {
        warnings.push(`Invalid previous balance for account ${accountId}: ${seededBalance}`);
      }
    }

    for (const change of ordered) {
      const currentBalance = new Decimal(change.absoluteNonstakedAmount);

      if (change.deltaAmountYocto) {
        previousBalance = currentBalance;
        continue;
      }

      if (previousBalance !== undefined) {
        const delta = currentBalance.minus(previousBalance);
        const deltaStr = delta.toFixed();
        derivedDeltas.set(change.eventId, deltaStr);
        previousBalance = currentBalance;
        continue;
      }

      if (change.direction === 'INBOUND' && !currentBalance.isZero()) {
        const deltaStr = currentBalance.toFixed();
        derivedDeltas.set(change.eventId, deltaStr);
        warnings.push(
          `Derived delta for first activity (assumed prior balance 0). ` +
            `Account=${accountId}, Receipt=${change.receiptId ?? 'unknown'}, Amount=${deltaStr}`
        );
        previousBalance = currentBalance;
        continue;
      }

      warnings.push(
        `Unable to derive delta for first activity (missing prior balance). ` +
          `Account=${accountId}, Receipt=${change.receiptId ?? 'unknown'}, Direction=${change.direction}`
      );
      previousBalance = currentBalance;
    }
  }

  return { derivedDeltas, warnings };
}

/**
 * Fee extraction result with optional warning for conflicts
 */
export interface FeeExtractionResult {
  movements: Movement[];
  warning?: string | undefined;
  source?: 'receipt' | 'balance-change' | undefined;
}

/**
 * Operation classification result
 */
export interface OperationClassification {
  category: 'transfer' | 'trade' | 'staking' | 'defi' | 'governance' | 'fee';
  type:
    | 'transfer'
    | 'deposit'
    | 'withdrawal'
    | 'swap'
    | 'buy'
    | 'sell'
    | 'stake'
    | 'unstake'
    | 'reward'
    | 'batch'
    | 'refund'
    | 'vote'
    | 'proposal'
    | 'airdrop'
    | 'fee';
}

/**
 * Group normalized transaction data by transaction hash
 *
 * Takes normalized events and groups them by transactionHash.
 * Each group contains all 4 stream types (transactions, receipts, balance-changes, token-transfers)
 * for a single parent transaction.
 *
 * IMPORTANT: This uses two-pass processing to resolve transaction hashes for orphaned items:
 * 1. First pass: Build receipt_id → transaction_hash map from receipts
 * 2. Second pass: Resolve transaction hash for activities/ft-transfers using receipt map
 *
 * @param events - Normalized stream events
 * @returns Map of transaction hash to grouped data
 */
export function groupNearEventsByTransaction(events: NearStreamEvent[]): Map<string, RawTransactionGroup> {
  // First pass: Build receipt_id → transaction_hash map
  const receiptIdToTxHash = new Map<string, string>();

  for (const event of events) {
    if (event.streamType === 'receipts') {
      const receipt = event;
      const receiptTxHash = receipt.transactionHash;
      if (receipt.receiptId && receiptTxHash) {
        receiptIdToTxHash.set(receipt.receiptId, receiptTxHash);
      }
    }
  }

  // Second pass: Group by transaction hash, resolving via receipt_id when needed
  const groups = new Map<string, RawTransactionGroup>();
  let skippedBalanceChanges = 0;
  let skippedTokenTransfers = 0;
  let skippedReceipts = 0;
  let skippedTransactions = 0;

  const getOrCreateGroup = (txHash: string): RawTransactionGroup => {
    let group = groups.get(txHash);
    if (!group) {
      group = {
        transaction: undefined,
        receipts: [],
        balanceChanges: [],
        tokenTransfers: [],
      };
      groups.set(txHash, group);
    }
    return group;
  };

  for (const event of events) {
    switch (event.streamType) {
      case 'transactions': {
        const transaction = event;
        const txHash = transaction.transactionHash;
        if (!txHash) {
          logger.error(
            `Skipping transaction with missing transaction_hash. ` +
              `Signer: ${transaction.signerAccountId}, Receiver: ${transaction.receiverAccountId}. ` +
              `THIS DATA WILL BE LOST.`
          );
          skippedTransactions++;
          continue;
        }
        const group = getOrCreateGroup(txHash);
        if (group.transaction) {
          throw new Error(`Duplicate transaction record for hash ${txHash}`);
        }
        group.transaction = transaction;
        break;
      }
      case 'receipts': {
        const receipt = event;
        const txHash = receipt.transactionHash;
        if (!txHash) {
          logger.error(
            `Skipping receipt with missing transaction_hash. ` +
              `Receipt: ${receipt.receiptId}, Predecessor: ${receipt.predecessorAccountId}, ` +
              `Receiver: ${receipt.receiverAccountId}. THIS DATA WILL BE LOST.`
          );
          skippedReceipts++;
          continue;
        }
        const group = getOrCreateGroup(txHash);
        group.receipts.push(receipt);
        break;
      }
      case 'balance-changes': {
        const balanceChange = event;
        let txHash = balanceChange.transactionHash;
        if (!txHash && balanceChange.receiptId && receiptIdToTxHash.has(balanceChange.receiptId)) {
          txHash = receiptIdToTxHash.get(balanceChange.receiptId)!;
        }
        if (!txHash) {
          // CRITICAL: Cannot correlate this balance change - missing transaction_hash or missing receipt correlation
          if (balanceChange.receiptId) {
            logger.warn(
              `Skipping balance change - receipt_id not found in receipts map and missing transaction_hash. ` +
                `Receipt: ${balanceChange.receiptId}, Account: ${balanceChange.affectedAccountId}, ` +
                `Block: ${balanceChange.blockHeight}, Delta: ${balanceChange.deltaAmountYocto ?? 'null'}, ` +
                `Cause: ${balanceChange.cause}. THIS DATA WILL BE LOST.`
            );
          } else {
            logger.warn(
              `Skipping orphaned balance change - missing both receipt_id and transaction_hash. ` +
                `Account: ${balanceChange.affectedAccountId}, Block: ${balanceChange.blockHeight}, ` +
                `Delta: ${balanceChange.deltaAmountYocto ?? 'null'}, Cause: ${balanceChange.cause}. ` +
                `THIS DATA WILL BE LOST.`
            );
          }
          skippedBalanceChanges++;
          continue;
        }
        const group = getOrCreateGroup(txHash);
        group.balanceChanges.push(balanceChange);
        break;
      }
      case 'token-transfers': {
        const tokenTransfer = event;
        const txHash = tokenTransfer.transactionHash;
        // Token transfers now have required transactionHash field (no receiptId)
        // Use transactionHash directly for correlation
        if (!txHash) {
          // CRITICAL: Cannot correlate this token transfer - missing transaction_hash
          logger.warn(
            `Skipping orphaned token transfer - missing transaction_hash. ` +
              `Account: ${tokenTransfer.affectedAccountId}, Contract: ${tokenTransfer.contractAddress}, ` +
              `Block: ${tokenTransfer.blockHeight}, Delta: ${tokenTransfer.deltaAmountYocto ?? 'null'}. ` +
              `THIS DATA WILL BE LOST.`
          );
          skippedTokenTransfers++;
          continue;
        }
        const group = getOrCreateGroup(txHash);
        group.tokenTransfers.push(tokenTransfer);
        break;
      }
      default:
        throw new Error(`Unknown transaction type hint: ${(event as { streamType?: string }).streamType}`);
    }
  }

  // Report summary of skipped items
  if (skippedBalanceChanges > 0 || skippedTokenTransfers > 0 || skippedReceipts > 0 || skippedTransactions > 0) {
    const skippedTotal = skippedBalanceChanges + skippedTokenTransfers + skippedReceipts + skippedTransactions;
    logger.error(
      `CRITICAL: Skipped ${skippedBalanceChanges} balance changes, ${skippedTokenTransfers} token transfers, ` +
        `${skippedReceipts} receipts, and ${skippedTransactions} transactions ` +
        `due to missing correlation keys (receipt_id and/or transaction_hash). ` +
        `This represents data loss in a financial system. ` +
        `Total raw events: ${events.length}, Successfully grouped: ${events.length - skippedTotal}`
    );
  }

  return groups;
}

/**
 * Validate that a transaction group has all required data
 *
 * @param txHash - Transaction hash (for error messages)
 * @param group - Transaction group to validate
 * @returns Error if validation fails, undefined if valid
 */
export function validateTransactionGroup(txHash: string, group: RawTransactionGroup): Result<void, Error> {
  if (!group.transaction) {
    return err(new Error(`Missing transaction record for hash ${txHash}`));
  }

  // Receipts, activities, and ft-transfers can be empty arrays (valid for some transactions)
  return ok(undefined);
}

/**
 * Correlate receipts with balance changes by receipt_id
 *
 * Attaches balance changes to their corresponding receipts.
 * This implements the two-hop correlation: transactions → receipts → activities.
 * Token transfers are handled at transaction level (no receipt correlation).
 *
 * NEAR's asynchronous architecture means balance changes occur at two distinct stages:
 * - TRANSACTION-LEVEL: Transaction acceptance costs (gas prepayment, deposits)
 *   → Attached to transaction-level synthetic receipt (expected behavior)
 * - RECEIPT-LEVEL: Execution outcomes (actual state changes, fund transfers)
 *   → Must correlate to specific receipt (fails fast if missing receipt_id)
 *
 * IMPORTANT: Assumes deltas have already been derived by deriveBalanceChangeDeltasFromAbsolutes()
 * before this function is called. This function validates delta presence and fails fast if missing.
 *
 * @param group - Transaction group with normalized data
 * @returns Correlated transaction with enriched receipts
 */
export function correlateTransactionData(group: RawTransactionGroup): Result<CorrelatedTransaction, Error> {
  if (!group.transaction) {
    return err(new Error('Missing transaction in group'));
  }

  // Convert receipts to processor type (adds empty balanceChanges array)
  const processedReceipts: NearReceipt[] = group.receipts.map((receipt) => ({
    receiptId: receipt.receiptId,
    transactionHash: receipt.transactionHash,
    predecessorAccountId: receipt.predecessorAccountId,
    receiverAccountId: receipt.receiverAccountId,
    receiptKind: receipt.receiptKind,
    blockHash: receipt.blockHash,
    blockHeight: receipt.blockHeight,
    timestamp: receipt.timestamp,
    executorAccountId: receipt.executorAccountId,
    gasBurnt: receipt.gasBurnt,
    tokensBurntYocto: receipt.tokensBurntYocto,
    status: receipt.status,
    logs: receipt.logs,
    actions: receipt.actions,
    balanceChanges: [],
  }));

  // Validate that all balance changes have deltas (should have been derived earlier)
  // Fail-fast on balance changes with missing deltas that would be used for correlation
  const balanceChangesWithoutDeltas = group.balanceChanges.filter((bc) => !bc.deltaAmountYocto && bc.receiptId);

  if (balanceChangesWithoutDeltas.length > 0) {
    const first = balanceChangesWithoutDeltas[0]!;
    return err(
      new Error(
        `Balance change missing deltaAmount for receipt ${first.receiptId} (account ${first.affectedAccountId}). ` +
          `Deltas should have been derived before correlation.`
      )
    );
  }

  // Group balance changes by receipt_id
  // NEAR's async architecture means some balance changes are transaction-level (expected to lack receipt_id)
  // while others are receipt-level (must have receipt_id). We differentiate by 'cause' field.
  const balanceChangesByReceipt = new Map<string, NearBalanceChange[]>();
  const txLevelReceiptId = `tx:${group.transaction.transactionHash}:transaction-level`;
  let hasTransactionLevelItems = false;

  // Build set of valid receipt IDs
  const validReceiptIds = new Set(processedReceipts.map((r) => r.receiptId));

  for (const balanceChange of group.balanceChanges) {
    let receiptId: string;

    if (TRANSACTION_LEVEL_CAUSES.has(balanceChange.cause)) {
      // Transaction-level balance changes (gas prepayment, deposit reservation)
      // These SHOULD NOT have receipt_id - it's correct NEAR semantics
      receiptId = txLevelReceiptId;
      hasTransactionLevelItems = true;

      if (balanceChange.receiptId) {
        logger.debug(
          {
            transactionHash: group.transaction.transactionHash,
            cause: balanceChange.cause,
            receiptId: balanceChange.receiptId,
          },
          'Transaction-level balance change unexpectedly has receipt_id (will use transaction-level receipt)'
        );
      }
    } else if (RECEIPT_LEVEL_CAUSES.has(balanceChange.cause)) {
      // Receipt-level balance changes (execution outcomes)
      // These MUST have valid receipt_id - fail fast on data quality issues
      if (!balanceChange.receiptId) {
        return err(
          new Error(
            `Balance change with cause '${balanceChange.cause}' missing receipt_id. ` +
              `This indicates data quality issues with the provider. ` +
              `Transaction: ${group.transaction.transactionHash}, ` +
              `Account: ${balanceChange.affectedAccountId}, ` +
              `Delta: ${balanceChange.deltaAmountYocto ?? 'null'}`
          )
        );
      }

      if (!validReceiptIds.has(balanceChange.receiptId)) {
        return err(
          new Error(
            `Balance change with cause '${balanceChange.cause}' has invalid receipt_id '${balanceChange.receiptId}'. ` +
              `Receipt ID does not match any known receipt for this transaction. ` +
              `This indicates incomplete data from the provider or cross-contract receipts not fetched. ` +
              `Transaction: ${group.transaction.transactionHash}, ` +
              `Valid receipt IDs: ${Array.from(validReceiptIds).join(', ')}`
          )
        );
      }

      receiptId = balanceChange.receiptId;
    } else if (AMBIGUOUS_CAUSES.has(balanceChange.cause)) {
      // Ambiguous causes can appear at either level
      // Prefer receipt_id if present and valid, otherwise use transaction-level (graceful)
      if (balanceChange.receiptId && validReceiptIds.has(balanceChange.receiptId)) {
        receiptId = balanceChange.receiptId;
      } else {
        receiptId = txLevelReceiptId;
        hasTransactionLevelItems = true;
        logger.debug(
          {
            transactionHash: group.transaction.transactionHash,
            cause: balanceChange.cause,
            hasReceiptId: !!balanceChange.receiptId,
            isValidReceiptId: balanceChange.receiptId ? validReceiptIds.has(balanceChange.receiptId) : false,
          },
          'Ambiguous-cause balance change without valid receipt_id (attaching to transaction-level)'
        );
      }
    } else {
      // Unknown cause - fail fast to force proper handling
      return err(
        new Error(
          `Unknown balance change cause '${balanceChange.cause}' encountered. ` +
            `Transaction: ${group.transaction.transactionHash}, ` +
            `Account: ${balanceChange.affectedAccountId}. ` +
            `This cause must be added to TRANSACTION_LEVEL_CAUSES, RECEIPT_LEVEL_CAUSES, or AMBIGUOUS_CAUSES.`
        )
      );
    }

    const existing = balanceChangesByReceipt.get(receiptId) || [];
    existing.push(balanceChange);
    balanceChangesByReceipt.set(receiptId, existing);
  }

  if (hasTransactionLevelItems) {
    const bcCount = balanceChangesByReceipt.get(txLevelReceiptId)?.length || 0;

    // Categorize balance changes by cause for informative logging
    const balanceChanges = balanceChangesByReceipt.get(txLevelReceiptId) || [];
    const causeBreakdown = new Map<NearBalanceChangeCause, number>();
    for (const bc of balanceChanges) {
      causeBreakdown.set(bc.cause, (causeBreakdown.get(bc.cause) || 0) + 1);
    }

    logger.info(
      {
        transactionHash: group.transaction.transactionHash,
        balanceChangesCount: bcCount,
        causeBreakdown: Object.fromEntries(causeBreakdown),
      },
      'Created transaction-level synthetic receipt for balance changes'
    );

    processedReceipts.push({
      receiptId: txLevelReceiptId,
      transactionHash: group.transaction.transactionHash,
      predecessorAccountId: group.transaction.signerAccountId,
      receiverAccountId: group.transaction.receiverAccountId,
      receiptKind: 'ACTION',
      blockHash: group.transaction.blockHash,
      blockHeight: group.transaction.blockHeight,
      timestamp: group.transaction.timestamp,
      status: group.transaction.status,
      balanceChanges: [],
      isSynthetic: true,
    });
  }

  // Attach to receipts
  for (const receipt of processedReceipts) {
    receipt.balanceChanges = balanceChangesByReceipt.get(receipt.receiptId) || [];
  }

  return ok({
    transaction: group.transaction,
    receipts: processedReceipts,
    tokenTransfers: group.tokenTransfers,
  });
}

/**
 * Extract fees from a receipt with single source of truth and conflict detection
 *
 * Priority order (per V4 plan):
 * 1. Receipt gas_burnt and tokens_burnt (most authoritative)
 * 2. Balance changes with 'fee' or 'gas' cause
 *
 * Logs a warning if both sources exist and differ significantly (>1% variance).
 *
 * @param receipt - Enriched receipt with balance changes
 * @param primaryAddress - User's address (fee payer filter)
 * @returns Fee extraction result with movements and optional warning
 */
export function extractReceiptFees(receipt: NearReceipt, primaryAddress: string): FeeExtractionResult {
  // Calculate both sources if they exist
  let receiptFee: Decimal | undefined;
  let balanceChangeFee: Decimal | undefined;
  const isPrimaryPayer = receipt.predecessorAccountId === primaryAddress;

  // Source 1: Explicit gas fees from receipt
  if (receipt.gasBurnt && receipt.tokensBurntYocto) {
    const tokensBurnt = new Decimal(receipt.tokensBurntYocto);
    if (!tokensBurnt.isZero()) {
      receiptFee = normalizeNearAmount(tokensBurnt);
    }
  }

  // Source 2: Balance changes with fee/gas cause
  // IMPORTANT: These conditions must match extractFlows to avoid double-counting
  if (receipt.balanceChanges && receipt.balanceChanges.length > 0) {
    const feeActivities = receipt.balanceChanges.filter(
      (bc) => FEE_CAUSES.has(bc.cause) && bc.affectedAccountId === primaryAddress
    );

    if (feeActivities.length > 0) {
      let totalFee = new Decimal(0);
      for (const activity of feeActivities) {
        if (activity.deltaAmountYocto) {
          const delta = new Decimal(activity.deltaAmountYocto);
          totalFee = totalFee.plus(normalizeNearAmount(delta.abs()));
        }
      }
      if (!totalFee.isZero()) {
        balanceChangeFee = totalFee;
      }
    }
  }

  // Detect conflicts if both sources exist
  let warning: string | undefined;
  if (receiptFee && balanceChangeFee && isPrimaryPayer) {
    const diff = receiptFee.minus(balanceChangeFee).abs();
    const percentDiff = diff.dividedBy(receiptFee).times(100);

    if (percentDiff.greaterThan(FEE_MISMATCH_THRESHOLD_PERCENT)) {
      warning =
        `Fee mismatch for receipt ${receipt.receiptId}: ` +
        `receipt tokensBurnt=${receiptFee.toFixed()} NEAR vs ` +
        `balance changes=${balanceChangeFee.toFixed()} NEAR ` +
        `(${percentDiff.toFixed(2)}% difference). Using receipt value as authoritative.`;
    }
  }

  // Priority 1: Use receipt fee if available
  if (receiptFee && isPrimaryPayer) {
    return {
      movements: [
        {
          asset: 'NEAR',
          amount: receiptFee,
          direction: 'out',
          flowType: 'fee',
        },
      ],
      warning,
      source: 'receipt',
    };
  }

  // Priority 2: Use balance change fee if available
  if (balanceChangeFee) {
    return {
      movements: [
        {
          asset: 'NEAR',
          amount: balanceChangeFee,
          direction: 'out',
          flowType: 'fee',
        },
      ],
      warning,
      source: 'balance-change',
    };
  }

  // No fees found
  return { movements: [] };
}

/**
 * Extract fund flows (inflows/outflows) from a receipt
 *
 * Analyzes balance changes and token transfers to determine movements.
 * Excludes fee-related flows (handled separately).
 *
 * @param receipt - Enriched receipt
 * @param primaryAddress - User's address
 * @returns Array of movements
 */
export function extractFlows(receipt: NearReceipt, primaryAddress: string): Movement[] {
  const movements: Movement[] = [];

  // Process balance changes (NEAR)
  if (receipt.balanceChanges) {
    for (const activity of receipt.balanceChanges) {
      if (activity.affectedAccountId !== primaryAddress) {
        continue;
      }
      // Skip fee-related activities (handled by extractReceiptFees)
      // Must match the same conditions as extractReceiptFees to avoid double-counting
      if (FEE_CAUSES.has(activity.cause)) {
        continue;
      }

      if (!activity.deltaAmountYocto) {
        continue; // Skip if no delta (already validated in correlation)
      }

      const delta = new Decimal(activity.deltaAmountYocto);
      if (delta.isZero()) {
        continue;
      }

      const direction = delta.isNegative() ? 'out' : 'in';
      const expectedDirection = activity.direction === 'INBOUND' ? 'in' : 'out';
      if (direction !== expectedDirection) {
        logger.warn(
          `NEAR balance change direction mismatch for ${activity.receiptId ?? 'unknown-receipt'}: ` +
            `declared=${activity.direction}, derived=${direction}, delta=${delta.toFixed()}`
        );
      }
      const normalizedAmount = normalizeNearAmount(delta.abs());

      movements.push({
        asset: 'NEAR',
        amount: normalizedAmount,
        direction,
        flowType: 'native',
      });
    }
  }

  return movements;
}

/**
 * Extract fund flows from token transfers at transaction level
 *
 * @param tokenTransfers - Token transfers for the transaction
 * @param primaryAddress - User's address
 * @returns Array of movements
 */
export function extractTokenTransferFlows(tokenTransfers: NearTokenTransfer[], primaryAddress: string): Movement[] {
  const movements: Movement[] = [];

  for (const transfer of tokenTransfers) {
    if (!transfer.deltaAmountYocto) {
      continue;
    }

    const delta = new Decimal(transfer.deltaAmountYocto);
    if (delta.isZero()) {
      continue;
    }

    // Determine direction based on affected account
    const direction = transfer.affectedAccountId === primaryAddress ? 'in' : 'out';
    const normalizedAmount = normalizeTokenAmount(delta.abs(), transfer.decimals);

    movements.push({
      asset: transfer.symbol || 'UNKNOWN',
      amount: normalizedAmount,
      contractAddress: transfer.contractAddress,
      direction,
      flowType: 'token_transfer',
    });
  }

  return movements;
}

/**
 * Consolidate movements by asset
 *
 * Aggregates multiple movements of the same asset into a single movement.
 * Used to create transaction-level inflows/outflows from receipt-level movements.
 *
 * @param movements - Array of movements to consolidate
 * @returns Map of asset to consolidated movement
 */
export function consolidateByAsset(movements: Movement[]): Map<string, Movement> {
  const consolidated = new Map<string, Movement>();

  for (const movement of movements) {
    const key = movement.contractAddress || movement.asset;

    const existing = consolidated.get(key);
    if (existing) {
      existing.amount = existing.amount.plus(movement.amount);
    } else {
      consolidated.set(key, { ...movement });
    }
  }

  return consolidated;
}

/**
 * Check if transaction is fee-only based on outflows
 *
 * A transaction has fee-only outflows when:
 * - No inflows
 * - Has outflows (which are treated as fees)
 * - No token transfers
 * - No deposit actions
 * - All outflows are NEAR native asset
 */
export function isFeeOnlyFromOutflows(
  consolidatedInflows: Movement[],
  consolidatedOutflows: Movement[],
  hasTokenTransfers: boolean,
  hasActionDeposits: boolean
): boolean {
  return (
    consolidatedInflows.length === 0 &&
    consolidatedOutflows.length > 0 &&
    !hasTokenTransfers &&
    !hasActionDeposits &&
    consolidatedOutflows.every((movement) => movement.asset === 'NEAR')
  );
}

/**
 * Check if transaction is fee-only based on fees
 *
 * A transaction has fee-only fees when:
 * - No inflows
 * - No outflows
 * - Has fees
 * - No token transfers
 * - No deposit actions
 * - All fees are NEAR native asset
 */
function isFeeOnlyFromFees(
  consolidatedInflows: Movement[],
  consolidatedOutflows: Movement[],
  consolidatedFees: Movement[],
  hasTokenTransfers: boolean,
  hasActionDeposits: boolean
): boolean {
  return (
    consolidatedInflows.length === 0 &&
    consolidatedOutflows.length === 0 &&
    consolidatedFees.length > 0 &&
    !hasTokenTransfers &&
    !hasActionDeposits &&
    consolidatedFees.every((movement) => movement.asset === 'NEAR')
  );
}

/**
 * Determine if transaction is fee-only
 *
 * Fee-only transactions have no meaningful fund flows, only network fees.
 * This occurs in two scenarios:
 * 1. Outflows that represent fees (no inflows, NEAR-only outflows)
 * 2. Pure fees with no other movements
 */
export function isFeeOnlyTransaction(
  consolidatedInflows: Movement[],
  consolidatedOutflows: Movement[],
  consolidatedFees: Movement[],
  hasTokenTransfers: boolean,
  hasActionDeposits: boolean
): boolean {
  return (
    isFeeOnlyFromOutflows(consolidatedInflows, consolidatedOutflows, hasTokenTransfers, hasActionDeposits) ||
    isFeeOnlyFromFees(consolidatedInflows, consolidatedOutflows, consolidatedFees, hasTokenTransfers, hasActionDeposits)
  );
}

/**
 * Extract all action types from receipts
 */
function getActionTypes(receipts: NearReceipt[]): NearActionType[] {
  const actionTypes: NearActionType[] = [];
  for (const receipt of receipts) {
    if (receipt.actions) {
      for (const action of receipt.actions) {
        actionTypes.push(action.actionType);
      }
    }
  }
  return actionTypes;
}

/**
 * Check if actions contain specific type
 */
function hasActionType(actionTypes: NearActionType[], type: NearActionType): boolean {
  return actionTypes.includes(type);
}

/**
 * Analyze balance change causes to determine operation context
 */
function analyzeBalanceChangeCauses(receipts: NearReceipt[]): {
  hasRefunds: boolean;
  hasRewards: boolean;
} {
  let hasRewards = false;
  let hasRefunds = false;

  for (const receipt of receipts) {
    if (receipt.balanceChanges) {
      for (const change of receipt.balanceChanges) {
        if (change.cause === 'CONTRACT_REWARD') {
          hasRewards = true;
        }
        if (change.cause === 'GAS_REFUND') {
          hasRefunds = true;
        }
      }
    }
  }

  return { hasRewards, hasRefunds };
}

/**
 * Classify operation type from correlated transaction
 *
 * Determines the transaction type based on receipts, actions, and fund flows.
 *
 * @param correlated - Correlated transaction
 * @param allInflows - All inflows across receipts
 * @param allOutflows - All outflows across receipts
 * @returns Operation classification
 */
export function classifyOperation(
  correlated: CorrelatedTransaction,
  allInflows: Movement[],
  allOutflows: Movement[]
): OperationClassification {
  const hasInflows = allInflows.length > 0;
  const hasOutflows = allOutflows.length > 0;
  const hasTokenTransfers =
    allInflows.some((m) => m.flowType === 'token_transfer') || allOutflows.some((m) => m.flowType === 'token_transfer');

  const actionTypes = getActionTypes(correlated.receipts);
  const { hasRewards, hasRefunds } = analyzeBalanceChangeCauses(correlated.receipts);

  // Staking operations
  if (hasActionType(actionTypes, 'stake')) {
    return {
      category: 'staking',
      type: 'stake',
    };
  }

  // Staking rewards (inflow with reward cause)
  if (hasInflows && !hasOutflows && hasRewards) {
    return {
      category: 'staking',
      type: 'reward',
    };
  }

  // Refunds (inflow with refund cause)
  if (hasInflows && !hasOutflows && hasRefunds) {
    return {
      category: 'transfer',
      type: 'refund',
    };
  }

  // Account creation
  if (hasActionType(actionTypes, 'create_account')) {
    return {
      category: 'defi',
      type: 'batch',
    };
  }

  // Inflows only (deposits)
  if (hasInflows && !hasOutflows) {
    return {
      category: 'transfer',
      type: 'deposit',
    };
  }

  // Outflows only (withdrawals)
  if (hasOutflows && !hasInflows) {
    return {
      category: 'transfer',
      type: 'withdrawal',
    };
  }

  // Both flows with tokens (swap/trade)
  if (hasInflows && hasOutflows && hasTokenTransfers) {
    return {
      category: 'trade',
      type: 'swap',
    };
  }

  // Both flows without tokens (transfer)
  if (hasInflows && hasOutflows) {
    return {
      category: 'transfer',
      type: 'transfer',
    };
  }

  // No flows (fee-only transaction or contract interaction)
  return {
    category: 'defi',
    type: 'batch',
  };
}
