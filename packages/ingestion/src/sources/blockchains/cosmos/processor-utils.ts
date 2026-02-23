import type { CosmosChainConfig, CosmosTransaction } from '@exitbook/blockchain-providers';
import { parseDecimal, type Currency, type OperationClassification } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { AddressContext } from '../../../shared/types/processors.js';

import type { CosmosFundFlow } from './types.js';

const logger = getLogger('cosmos-processor-utils');

/**
 * Checks if a string value represents zero.
 *
 * Pure function that safely parses and checks for zero values.
 * Returns true if the value is zero, undefined, or cannot be parsed.
 */
export function isZero(value: string): boolean {
  try {
    return parseDecimal(value || '0').isZero();
  } catch (error) {
    logger.warn({ error, value }, 'Failed to parse decimal value, treating as zero');
    return true;
  }
}

/**
 * Converts a string value to Decimal.
 *
 * Pure function that safely parses a string value into a Decimal.
 * Returns zero if the value is undefined or cannot be parsed.
 */
export function toDecimal(value: string): Decimal {
  return parseDecimal(value || '0');
}

/**
 * Deduplicates transactions by eventId, keeping the first occurrence.
 *
 * Pure function that handles validator consensus transactions (e.g., Peggy deposits)
 * where multiple validators submit the same claim as separate blockchain transactions.
 * Each validator submits their own transaction, but they all represent the same
 * logical event (identified by event_nonce or similar mechanism) and should share the same eventId.
 */
export function deduplicateByEventId(transactions: CosmosTransaction[]): CosmosTransaction[] {
  const seen = new Set<string>();
  const deduplicated: CosmosTransaction[] = [];

  for (const tx of transactions) {
    if (!seen.has(tx.eventId)) {
      seen.add(tx.eventId);
      deduplicated.push(tx);
    }
  }

  return deduplicated;
}

/**
 * Analyzes fund flow from normalized CosmosTransaction data.
 *
 * Pure function that collects ALL assets that move in/out (following EVM pattern).
 * Examines the transaction and determines:
 * - All inflows (assets received by the user)
 * - All outflows (assets sent by the user)
 * - Primary asset (the transferred asset for simplified display)
 * - Transaction complexity (bridge transfers, IBC, contract interactions)
 * - Network fees
 *
 * Note: Addresses should already be normalized to lowercase via CosmosAddressSchema.
 */
export function analyzeСosmosFundFlow(
  transaction: CosmosTransaction,
  context: AddressContext,
  chainConfig: CosmosChainConfig
): CosmosFundFlow {
  const userAddress = context.primaryAddress;
  // Analyze transaction type context
  const hasBridgeTransfer = transaction.bridgeType === 'peggy' || transaction.bridgeType === 'ibc';
  const hasIbcTransfer = transaction.bridgeType === 'ibc';
  const hasContractInteraction = Boolean(
    transaction.tokenAddress ||
    transaction.messageType?.includes('wasm') ||
    transaction.messageType?.includes('contract')
  );

  // Collect ALL assets that flow in/out (using Cosmos-specific 'denom' terminology)
  const inflows: {
    amount: string;
    asset: Currency;
    denom?: string;
    tokenDecimals?: number;
  }[] = [];
  const outflows: {
    amount: string;
    asset: Currency;
    denom?: string;
    tokenDecimals?: number;
  }[] = [];

  // Determine flow direction
  const isIncoming = transaction.to === userAddress;
  const isOutgoing = transaction.from === userAddress;

  // Skip zero amounts
  const amount = transaction.amount;
  const isAmountZero = isZero(amount);

  if (!isAmountZero) {
    const asset = (transaction.currency || chainConfig.nativeCurrency) as Currency;
    const movement: {
      amount: string;
      asset: Currency;
      denom?: string;
      tokenDecimals?: number;
    } = {
      amount,
      asset,
    };

    // Only add optional fields if they have values
    // Map tokenAddress from provider to denom (Cosmos-specific terminology)
    if (transaction.tokenAddress !== undefined) {
      movement.denom = transaction.tokenAddress;
    }
    if (transaction.tokenDecimals !== undefined) {
      movement.tokenDecimals = transaction.tokenDecimals;
    }

    // For self-transfers (user -> user), track both inflow and outflow
    if (isIncoming && isOutgoing) {
      inflows.push({ ...movement });
      outflows.push({ ...movement });
    } else {
      if (isIncoming) {
        inflows.push(movement);
      }
      if (isOutgoing) {
        outflows.push(movement);
      }
    }
  }

  // Select primary asset (for simplified consumption and single-asset display)
  // Use the transferred asset as primary
  const primary: {
    amount: string;
    asset: Currency;
    denom?: string;
    tokenDecimals?: number;
  } = {
    amount: transaction.amount,
    asset: (transaction.currency || chainConfig.nativeCurrency) as Currency,
  };

  // Only add optional fields if they have values
  // Map tokenAddress from provider to denom (Cosmos-specific terminology)
  if (transaction.tokenAddress !== undefined) {
    primary.denom = transaction.tokenAddress;
  }
  if (transaction.tokenDecimals !== undefined) {
    primary.tokenDecimals = transaction.tokenDecimals;
  }

  // Fee information (always in native currency for Cosmos SDK chains)
  const feeAmount = transaction.feeAmount || '0';
  const feeCurrency = (transaction.feeCurrency || chainConfig.nativeCurrency) as Currency;

  // Track uncertainty for complex transactions
  let classificationUncertainty: string | undefined;
  if (inflows.length > 1 || outflows.length > 1) {
    classificationUncertainty = `Complex transaction with ${outflows.length} outflow(s) and ${inflows.length} inflow(s). May be multi-asset operation.`;
  }

  const result: CosmosFundFlow = {
    bridgeType: transaction.bridgeType,
    destinationChain: transaction.sourceChannel ? chainConfig.chainName : undefined,
    feeAmount,
    feeCurrency,
    fromAddress: transaction.from,
    hasBridgeTransfer,
    hasContractInteraction,
    hasIbcTransfer,
    inflows,
    outflows,
    primary,
    sourceChain: transaction.sourceChannel ? 'ibc' : undefined,
    toAddress: transaction.to,
  };

  // Only add classificationUncertainty if it has a value
  if (classificationUncertainty !== undefined) {
    result.classificationUncertainty = classificationUncertainty;
  }

  return result;
}

/**
 * Determines transaction operation classification based purely on fund flow structure.
 *
 * Pure function that applies 9 conservative pattern matching rules to classify transactions.
 * Only classifies patterns we're confident about - complex cases receive informational notes.
 *
 * Pattern matching rules:
 * 1. Contract interaction with zero value (approvals, delegation, state changes)
 * 2. Fee-only transaction (zero value with no fund movements)
 * 3. Bridge deposit (receiving funds from another chain via Peggy/IBC)
 * 4. Bridge withdrawal (sending funds to another chain via Peggy/IBC)
 * 5. Single asset swap (one asset out, different asset in)
 * 6. Simple deposit (only inflows, no outflows)
 * 7. Simple withdrawal (only outflows, no inflows)
 * 8. Self-transfer (same asset in and out)
 * 9. Complex multi-asset transaction (multiple inflows/outflows - uncertain)
 */
export function determineOperationFromFundFlow(fundFlow: CosmosFundFlow): OperationClassification {
  const { inflows, outflows } = fundFlow;
  const amount = toDecimal(fundFlow.primary.amount).abs();
  const isAmountZero = amount.isZero();

  // Pattern 1: Contract interaction with zero value
  // Classified as transfer with note (contract call, approval, etc.)
  if (isAmountZero && fundFlow.hasContractInteraction) {
    return {
      notes: [
        {
          message: `Contract interaction with zero value. May be approval, delegation, or other state change.`,
          metadata: {
            hasContractInteraction: fundFlow.hasContractInteraction,
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
  if (isAmountZero && inflows.length === 0 && outflows.length === 0) {
    return {
      operation: {
        category: 'fee',
        type: 'fee',
      },
    };
  }

  // Pattern 3: Bridge deposit (Peggy, Gravity Bridge, or IBC)
  // Receiving funds from another chain
  if (fundFlow.hasBridgeTransfer && outflows.length === 0 && inflows.length >= 1) {
    const bridgeInfo =
      fundFlow.bridgeType === 'peggy'
        ? 'Peggy bridge from Ethereum'
        : fundFlow.bridgeType === 'gravity'
          ? 'Gravity Bridge from Ethereum'
          : 'IBC transfer from another chain';
    return {
      notes: [
        {
          message: `Bridge deposit via ${bridgeInfo}.`,
          metadata: {
            bridgeType: fundFlow.bridgeType,
            destinationChain: fundFlow.destinationChain,
            sourceChain: fundFlow.sourceChain,
          },
          severity: 'info',
          type: 'bridge_transfer',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  // Pattern 4: Bridge withdrawal (Peggy, Gravity Bridge, or IBC)
  // Sending funds to another chain
  if (fundFlow.hasBridgeTransfer && outflows.length >= 1 && inflows.length === 0) {
    const bridgeInfo =
      fundFlow.bridgeType === 'peggy'
        ? 'Peggy bridge to Ethereum'
        : fundFlow.bridgeType === 'gravity'
          ? 'Gravity Bridge to Ethereum'
          : 'IBC transfer to another chain';
    return {
      notes: [
        {
          message: `Bridge withdrawal via ${bridgeInfo}.`,
          metadata: {
            bridgeType: fundFlow.bridgeType,
            destinationChain: fundFlow.destinationChain,
            sourceChain: fundFlow.sourceChain,
          },
          severity: 'info',
          type: 'bridge_transfer',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  // Pattern 5: Single asset swap
  // One asset out, different asset in (DeFi swap)
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset !== inAsset) {
      return {
        notes: [
          {
            message: `Asset swap: ${outAsset} → ${inAsset}.`,
            metadata: {
              inAsset,
              outAsset,
            },
            severity: 'info',
            type: 'swap',
          },
        ],
        operation: {
          category: 'trade',
          type: 'swap',
        },
      };
    }
  }

  // Pattern 6: Simple deposit
  // Only inflows, no outflows
  if (outflows.length === 0 && inflows.length >= 1) {
    return {
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  // Pattern 7: Simple withdrawal
  // Only outflows, no inflows
  if (outflows.length >= 1 && inflows.length === 0) {
    return {
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  // Pattern 8: Self-transfer
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

  // Pattern 9: Complex multi-asset transaction (UNCERTAIN - add note)
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
