import type { EvmChainConfig, EvmTransaction } from '@exitbook/blockchain-providers';
import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/blockchain-providers';
import { parseDecimal, type Currency, type OperationClassification } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { AddressContext } from '../../../shared/types/processors.js';

import type { EvmFundFlow, EvmMovement } from './types.js';

const logger = getLogger('evm-processor-utils');

/**
 * Tax Classification Rules
 */

/**
 * 32 ETH threshold for classifying beacon withdrawals.
 * - Withdrawals >= 32 ETH: Likely full validator withdrawal (principal return, non-taxable)
 * - Withdrawals < 32 ETH: Likely partial withdrawal (staking rewards, taxable income)
 *
 * Referenced in Product Decision #1
 */
const BEACON_WITHDRAWAL_PRINCIPAL_THRESHOLD = parseDecimal('32');

export interface SelectionCriteria {
  nativeCurrency: Currency;
}

/**
 * Consolidates duplicate assets by summing amounts for the same asset.
 *
 * Pure function that merges multiple movements of the same asset into a single movement
 * with the combined amount. Preserves token metadata (address and decimals) from the
 * first occurrence of each asset.
 */
export function consolidateEvmMovementsByAsset(movements: EvmMovement[]): EvmMovement[] {
  const assetMap = new Map<
    string,
    { amount: Decimal; tokenAddress?: string | undefined; tokenDecimals?: number | undefined }
  >();

  for (const movement of movements) {
    const existing = assetMap.get(movement.asset);
    if (existing) {
      existing.amount = existing.amount.plus(parseDecimal(movement.amount));
    } else {
      assetMap.set(movement.asset, {
        amount: parseDecimal(movement.amount),
        tokenAddress: movement.tokenAddress,
        tokenDecimals: movement.tokenDecimals,
      });
    }
  }

  return Array.from(assetMap.entries()).map(([asset, data]) => ({
    amount: data.amount.toFixed(),
    asset: asset as Currency,
    tokenAddress: data.tokenAddress,
    tokenDecimals: data.tokenDecimals,
  }));
}

/**
 * Selects the primary asset movement from a list of movements.
 *
 * Pure function that prioritizes the largest non-zero movement. Used to provide a simplified
 * summary of complex multi-asset transactions by identifying the most significant asset flow.
 *
 * Returns null if no non-zero movements are found.
 */
export function selectPrimaryEvmMovement(movements: EvmMovement[], criteria: SelectionCriteria): EvmMovement | null {
  // Find largest non-zero movement
  const largestMovement = movements
    .sort((a, b) => {
      try {
        return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
      } catch (error) {
        logger.warn({ error, itemA: a, itemB: b }, 'Failed to parse amount during sort comparison, treating as equal');
        return 0;
      }
    })
    .find((movement) => {
      try {
        return !parseDecimal(movement.amount || '0').isZero();
      } catch (error) {
        logger.warn({ error, movement }, 'Failed to parse amount during filter, excluding movement');
        return false;
      }
    });

  // Fallback to native currency with zero amount if no non-zero movements found
  return largestMovement ?? { asset: criteria.nativeCurrency, amount: '0' };
}

/**
 * Determines transaction operation classification based purely on fund flow structure.
 *
 * Pure function that applies pattern matching rules to classify transactions.
 * Only classifies patterns we're confident about - complex cases receive informational notes.
 *
 * Pattern matching rules:
 * 0. Beacon withdrawal (Ethereum consensus layer withdrawal with 32 ETH threshold)
 * 1. Contract interaction with zero value (approvals, staking, state changes)
 * 2. Fee-only transaction (zero value with no fund movements)
 * 3. Single asset swap (one asset out, different asset in)
 * 4. Simple deposit (only inflows, no outflows)
 * 5. Simple withdrawal (only outflows, no inflows)
 * 6. Self-transfer (same asset in and out)
 * 7. Complex multi-asset transaction (multiple inflows/outflows - uncertain)
 */
export function determineEvmOperationFromFundFlow(
  fundFlow: EvmFundFlow,
  txGroup: EvmTransaction[]
): OperationClassification {
  const { inflows, outflows } = fundFlow;
  const amount = parseDecimal(fundFlow.primary.amount || '0').abs();
  const isZero = amount.isZero();

  // Pattern 0: Beacon withdrawal (Ethereum post-Shanghai consensus layer withdrawals)
  // Apply smart tax classification based on 32 ETH threshold (Product Decision #1)
  const hasBeaconWithdrawal = txGroup.some((tx) => tx.type === 'beacon_withdrawal');
  if (hasBeaconWithdrawal) {
    // Check if withdrawal amount exceeds the principal threshold
    const isPrincipalReturn = amount.gte(BEACON_WITHDRAWAL_PRINCIPAL_THRESHOLD);

    // Extract withdrawal metadata from the beacon withdrawal transaction
    const beaconTx = txGroup.find((tx) => tx.type === 'beacon_withdrawal');
    const withdrawalMetadata: Record<string, unknown> = {
      amount: amount.toFixed(),
      needsReview: isPrincipalReturn,
      taxClassification: isPrincipalReturn ? 'non-taxable (principal return)' : 'taxable (income)',
    };

    // Include withdrawal-specific metadata if available
    if (beaconTx) {
      if (beaconTx.withdrawalIndex !== undefined) {
        withdrawalMetadata['withdrawalIndex'] = beaconTx.withdrawalIndex;
      }
      if (beaconTx.validatorIndex !== undefined) {
        withdrawalMetadata['validatorIndex'] = beaconTx.validatorIndex;
      }
      if (beaconTx.blockHeight !== undefined) {
        withdrawalMetadata['blockHeight'] = beaconTx.blockHeight;
      }
    }

    return {
      operation: {
        category: 'staking',
        type: isPrincipalReturn ? 'deposit' : 'reward',
      },
      notes: [
        {
          type: 'consensus_withdrawal',
          message: isPrincipalReturn
            ? 'Full withdrawal (≥32 ETH) - likely principal return. Verify if rewards are included.'
            : 'Partial withdrawal (<32 ETH) - staking reward',
          severity: isPrincipalReturn ? 'warning' : 'info',
          metadata: withdrawalMetadata,
        },
      ],
    };
  }

  // Pattern 1: Contract interaction with zero value
  // Approvals, staking operations, state changes - classified as transfer with note
  if (isZero && (fundFlow.hasContractInteraction || fundFlow.hasTokenTransfers)) {
    return {
      notes: [
        {
          message: `Contract interaction with zero value. May be approval, staking, or other state change.`,
          metadata: {
            hasContractInteraction: fundFlow.hasContractInteraction,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
          },
          severity: 'info',
          type: 'contract_interaction',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Pattern 2: Fee-only transaction
  // Zero value with NO fund movements at all
  if (isZero && inflows.length === 0 && outflows.length === 0) {
    return {
      operation: {
        category: 'fee',
        type: 'fee',
      },
    };
  }

  // Pattern 3: Single asset swap
  // One asset out, different asset in
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset !== inAsset) {
      return {
        operation: {
          category: 'trade',
          type: 'swap',
        },
      };
    }
  }

  // Pattern 4: Simple deposit
  // Only inflows, no outflows (can be multiple assets)
  if (outflows.length === 0 && inflows.length >= 1) {
    return {
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  // Pattern 5: Simple withdrawal
  // Only outflows, no inflows (can be multiple assets)
  if (outflows.length >= 1 && inflows.length === 0) {
    return {
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  // Pattern 6: Self-transfer
  // Same asset in and out
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset === inAsset) {
      return {
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }
  }

  // Pattern 7: Complex multi-asset transaction (UNCERTAIN - add note)
  // Multiple inflows or outflows - could be LP, batch, multi-swap
  if (fundFlow.classificationUncertainty) {
    return {
      notes: [
        {
          message: fundFlow.classificationUncertainty,
          metadata: {
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'classification_uncertain',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Ultimate fallback: Couldn't match any confident pattern
  return {
    notes: [
      {
        message: 'Unable to determine transaction classification using confident patterns.',
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'warning',
        type: 'classification_failed',
      },
    ],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
  };
}

/**
 * Groups EVM transactions by their hash.
 *
 * Pure function that organizes transactions into groups based on their transaction ID.
 * Multiple events (token transfers, internal transactions) from the same on-chain transaction
 * share the same hash and are grouped together for correlation.
 *
 * Returns a Map where keys are transaction hashes and values are arrays of correlated transactions.
 * Transactions without an ID are skipped.
 */
export function groupEvmTransactionsByHash(transactions: EvmTransaction[]): Map<string, EvmTransaction[]> {
  const groups = new Map<string, EvmTransaction[]>();

  for (const tx of transactions) {
    if (!tx?.id) {
      continue;
    }

    if (!groups.has(tx.id)) {
      groups.set(tx.id, []);
    }

    groups.get(tx.id)!.push(tx);
  }

  return groups;
}

/**
 * Analyzes fund flow from a normalized transaction group.
 *
 * Pure function that examines all transactions in a correlated group and determines:
 * - All inflows (assets received by the user)
 * - All outflows (assets sent by the user)
 * - Primary asset (largest movement for simplified display)
 * - Transaction complexity (token transfers, internal transactions, contract interactions)
 * - Network fees
 *
 * This is the core business logic for EVM transaction processing - 214 lines of complex analysis
 * that transforms raw blockchain events into structured fund flow data.
 */
export function analyzeEvmFundFlow(
  txGroup: EvmTransaction[],
  context: AddressContext,
  chainConfig: EvmChainConfig
): Result<EvmFundFlow, string> {
  if (txGroup.length === 0) {
    return err('Empty transaction group');
  }

  // Address is already normalized by blockchain-specific schemas
  const userAddress = context.primaryAddress;

  // Analyze transaction group complexity - essential for proper EVM classification
  const hasTokenTransfers = txGroup.some((tx) => tx.type === 'token_transfer');
  const hasInternalTransactions = txGroup.some((tx) => tx.type === 'internal');
  const hasContractInteraction = txGroup.some(
    (tx) =>
      tx.type === 'contract_call' ||
      Boolean(tx.methodId) || // Has function selector (0x12345678)
      Boolean(tx.functionName) // Function name decoded by provider
  );

  // Collect ALL assets that flow in/out (not just pick one as primary)
  const inflows: EvmMovement[] = [];
  const outflows: EvmMovement[] = [];

  let fromAddress = '';
  let toAddress: string | undefined = '';

  // Process all token transfers involving the user
  for (const tx of txGroup) {
    if (tx.type === 'token_transfer' && isEvmUserParticipant(tx, userAddress)) {
      const tokenSymbol = (tx.tokenSymbol || tx.currency || 'UNKNOWN') as Currency;
      const rawAmount = tx.amount ?? '0';

      // Normalize token amount using decimals metadata
      // All providers return amounts in smallest units; normalization ensures consistency and safety
      const amountResult = normalizeTokenAmount(rawAmount, tx.tokenDecimals);
      if (amountResult.isErr()) {
        return err(
          `Failed to normalize EVM token amount for transaction ${tx.id}: ${amountResult.error.message}. ` +
            `Raw amount: ${rawAmount}, decimals: ${tx.tokenDecimals}, token: ${tokenSymbol}`
        );
      }
      const amount = amountResult.value;

      // Skip zero amounts
      if (isZeroDecimal(amount)) {
        continue;
      }

      const fromMatches = matchesEvmAddress(tx.from, userAddress);
      const toMatches = matchesEvmAddress(tx.to, userAddress);

      // For self-transfers (user -> user), track both inflow and outflow
      if (fromMatches && toMatches) {
        const movement: EvmMovement = {
          amount,
          asset: tokenSymbol,
          tokenAddress: tx.tokenAddress,
          tokenDecimals: tx.tokenDecimals,
        };
        inflows.push(movement);
        outflows.push({ ...movement });
      } else {
        if (toMatches) {
          // User received this token
          const inflow: EvmMovement = {
            amount,
            asset: tokenSymbol,
            tokenAddress: tx.tokenAddress,
            tokenDecimals: tx.tokenDecimals,
          };
          inflows.push(inflow);
        }

        if (fromMatches) {
          // User sent this token
          const outflow: EvmMovement = {
            amount,
            asset: tokenSymbol,
            tokenAddress: tx.tokenAddress,
            tokenDecimals: tx.tokenDecimals,
          };
          outflows.push(outflow);
        }
      }

      // Track addresses
      if (!fromAddress && fromMatches) {
        fromAddress = tx.from;
      }
      if (!toAddress && toMatches) {
        toAddress = tx.to;
      }
      if (!fromAddress) {
        fromAddress = tx.from;
      }
      if (!toAddress) {
        toAddress = tx.to;
      }
    }
  }

  // Process all native currency movements involving the user
  for (const tx of txGroup) {
    if (isEvmNativeMovement(tx, chainConfig) && isEvmUserParticipant(tx, userAddress)) {
      const normalizedAmountResult = normalizeNativeAmount(tx.amount, chainConfig.nativeDecimals);
      if (normalizedAmountResult.isErr()) {
        return err(
          `Failed to normalize EVM native amount for transaction ${tx.id}: ${normalizedAmountResult.error.message}. ` +
            `Raw amount: ${tx.amount}, decimals: ${chainConfig.nativeDecimals}, currency: ${chainConfig.nativeCurrency}`
        );
      }
      const normalizedAmount = normalizedAmountResult.value;

      // Skip zero amounts
      if (isZeroDecimal(normalizedAmount)) {
        continue;
      }

      const fromMatches = matchesEvmAddress(tx.from, userAddress);
      const toMatches = matchesEvmAddress(tx.to, userAddress);

      // For self-transfers (user -> user), track both inflow and outflow
      if (fromMatches && toMatches) {
        const movement = {
          amount: normalizedAmount,
          asset: chainConfig.nativeCurrency,
        };
        inflows.push(movement);
        outflows.push({ ...movement });
      } else {
        if (toMatches) {
          // User received native currency
          inflows.push({
            amount: normalizedAmount,
            asset: chainConfig.nativeCurrency,
          });
        }

        if (fromMatches) {
          // User sent native currency
          outflows.push({
            amount: normalizedAmount,
            asset: chainConfig.nativeCurrency,
          });
        }
      }

      // Track addresses
      if (!fromAddress && fromMatches) {
        fromAddress = tx.from;
      }
      if (!toAddress && toMatches) {
        toAddress = tx.to;
      }
      if (!fromAddress) {
        fromAddress = tx.from;
      }
      if (!toAddress) {
        toAddress = tx.to;
      }
    }
  }

  // Final fallback: use first transaction to populate addresses
  const primaryTx = txGroup[0];
  if (primaryTx) {
    if (!fromAddress) {
      fromAddress = primaryTx.from;
    }
    if (!toAddress) {
      toAddress = primaryTx.to;
    }
  }

  // Consolidate duplicate assets (sum amounts for same asset)
  const consolidatedInflows = consolidateEvmMovementsByAsset(inflows);
  const consolidatedOutflows = consolidateEvmMovementsByAsset(outflows);

  // Select primary asset for simplified consumption and single-asset display
  // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
  const primaryFromInflows = selectPrimaryEvmMovement(consolidatedInflows, {
    nativeCurrency: chainConfig.nativeCurrency,
  });

  const primary: EvmMovement =
    primaryFromInflows && !isZeroDecimal(primaryFromInflows.amount)
      ? primaryFromInflows
      : selectPrimaryEvmMovement(consolidatedOutflows, {
          nativeCurrency: chainConfig.nativeCurrency,
        }) || {
          asset: chainConfig.nativeCurrency,
          amount: '0',
        };

  // Get fee from the parent transaction (NOT from token_transfer events)
  // A single on-chain transaction has only ONE fee, but providers may duplicate it across
  // the parent transaction and child events (token transfers, internal calls).
  // CRITICAL: Prioritize transactions with a NON-ZERO feeAmount. Some providers
  // (like Routescan) may include internal transactions without fee fields, and others
  // (like Moralis) explicitly set internal feeAmount to "0". Array ordering isn't
  // guaranteed, so we must pick the fee-bearing event first.
  const feeSourceTx =
    txGroup.find((tx) => tx.type !== 'token_transfer' && tx.feeAmount && !isZeroDecimal(tx.feeAmount)) || // Parent tx WITH non-zero fee
    txGroup.find((tx) => tx.type !== 'token_transfer' && tx.feeAmount) || // Parent tx WITH fee field (possibly zero)
    txGroup.find((tx) => tx.type !== 'token_transfer') || // Any parent transaction
    txGroup[0]; // Fallback
  const feeWei = feeSourceTx?.feeAmount ? parseDecimal(feeSourceTx.feeAmount) : parseDecimal('0');
  const feeAmount = feeWei.dividedBy(parseDecimal('10').pow(chainConfig.nativeDecimals)).toFixed();

  // Track uncertainty for complex transactions
  let classificationUncertainty: string | undefined;
  if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
    classificationUncertainty = `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be liquidity provision, batch operation, or multi-asset swap.`;
  }

  return ok({
    classificationUncertainty,
    feeAmount,
    feeCurrency: chainConfig.nativeCurrency,
    feePayerAddress: feeSourceTx?.from,
    fromAddress,
    hasContractInteraction,
    hasInternalTransactions,
    hasTokenTransfers,
    inflows: consolidatedInflows,
    outflows: consolidatedOutflows,
    primary,
    toAddress,
    transactionCount: txGroup.length,
  });
}

/**
 * Selects the primary transaction from a correlated group.
 *
 * Pure function that chooses the most representative transaction for event_id and metadata.
 * Prioritizes token transfers when present, then follows a preferred order of transaction types.
 */
export function selectPrimaryEvmTransaction(
  txGroup: EvmTransaction[],
  fundFlow: EvmFundFlow
): EvmTransaction | undefined {
  if (fundFlow.hasTokenTransfers) {
    const tokenTx = txGroup.find((tx) => tx.type === 'token_transfer');
    if (tokenTx) {
      return tokenTx;
    }
  }

  const preferredOrder: EvmTransaction['type'][] = ['transfer', 'contract_call', 'internal'];

  for (const type of preferredOrder) {
    const match = txGroup.find((tx) => tx.type === type);
    if (match) {
      return match;
    }
  }

  return txGroup[0];
}

/**
 * Checks if an address matches the target address.
 *
 * Pure function for case-sensitive address comparison.
 * Addresses should already be normalized to lowercase via EvmAddressSchema.
 */
export function matchesEvmAddress(address: string | undefined, target: string): boolean {
  return address ? address === target : false;
}

/**
 * Checks if the user is a participant in the transaction.
 *
 * Pure function that returns true if the user is either the sender or receiver.
 */
export function isEvmUserParticipant(tx: EvmTransaction, userAddress: string): boolean {
  return matchesEvmAddress(tx.from, userAddress) || matchesEvmAddress(tx.to, userAddress);
}

/**
 * Checks if a transaction represents a native currency movement.
 *
 * Pure function that determines if the transaction involves the chain's native currency
 * (ETH, MATIC, etc.) rather than a token.
 */
export function isEvmNativeMovement(tx: EvmTransaction, chainConfig: EvmChainConfig): boolean {
  const native = chainConfig.nativeCurrency.toLowerCase();
  return tx.currency.toLowerCase() === native || (tx.tokenSymbol ? tx.tokenSymbol.toLowerCase() === native : false);
}

/**
 * Checks if a decimal value is zero.
 *
 * Pure function that safely parses and checks for zero values.
 * Returns true if the value is zero, undefined, or cannot be parsed.
 */
export function isZeroDecimal(value: string): boolean {
  try {
    return parseDecimal(value || '0').isZero();
  } catch (error) {
    logger.warn({ error, value }, 'Failed to parse decimal value, treating as zero');
    return true;
  }
}
