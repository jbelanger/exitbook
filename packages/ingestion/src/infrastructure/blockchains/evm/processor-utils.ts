import type { OperationClassification } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { EvmFundFlow, EvmMovement } from './types.ts';

export interface SelectionCriteria {
  nativeCurrency: string;
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
      const entry: { amount: Decimal; tokenAddress?: string; tokenDecimals?: number } = {
        amount: parseDecimal(movement.amount),
      };
      if (movement.tokenAddress !== undefined) {
        entry.tokenAddress = movement.tokenAddress;
      }
      if (movement.tokenDecimals !== undefined) {
        entry.tokenDecimals = movement.tokenDecimals;
      }
      assetMap.set(movement.asset, entry);
    }
  }

  return Array.from(assetMap.entries()).map(([asset, data]) => {
    const result: EvmMovement = {
      amount: data.amount.toFixed(),
      asset,
      tokenAddress: data.tokenAddress,
      tokenDecimals: data.tokenDecimals,
    };
    return result;
  });
}

/**
 * Selects the primary asset movement from a list of movements.
 *
 * Pure function that prioritizes the largest non-zero movement. Used to provide a simplified
 * summary of complex multi-asset transactions by identifying the most significant asset flow.
 *
 * Returns null if no non-zero movements are found.
 */
export function selectPrimaryEvmMovement(
  movements: EvmMovement[],
  criteria: SelectionCriteria
): EvmMovement | null {
  // Find largest non-zero movement
  const largestMovement = movements
    .sort((a, b) => {
      try {
        return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
      } catch {
        return 0;
      }
    })
    .find((movement) => {
      try {
        return !parseDecimal(movement.amount || '0').isZero();
      } catch {
        return false;
      }
    });

  if (largestMovement) {
    return {
      asset: largestMovement.asset,
      amount: largestMovement.amount,
      tokenAddress: largestMovement.tokenAddress,
      tokenDecimals: largestMovement.tokenDecimals,
    };
  }

  // Fallback to native currency with zero amount if no movements found
  return {
    asset: criteria.nativeCurrency,
    amount: '0',
  };
}

/**
 * Determines transaction operation classification based purely on fund flow structure.
 *
 * Pure function that applies 7 conservative pattern matching rules to classify transactions.
 * Only classifies patterns we're confident about - complex cases receive informational notes.
 *
 * Pattern matching rules:
 * 1. Contract interaction with zero value (approvals, staking, state changes)
 * 2. Fee-only transaction (zero value with no fund movements)
 * 3. Single asset swap (one asset out, different asset in)
 * 4. Simple deposit (only inflows, no outflows)
 * 5. Simple withdrawal (only outflows, no inflows)
 * 6. Self-transfer (same asset in and out)
 * 7. Complex multi-asset transaction (multiple inflows/outflows - uncertain)
 */
export function determineEvmOperationFromFundFlow(fundFlow: EvmFundFlow): OperationClassification {
  const { inflows, outflows } = fundFlow;
  const amount = parseDecimal(fundFlow.primary.amount || '0').abs();
  const isZero = amount.isZero();

  // Pattern 1: Contract interaction with zero value
  // Approvals, staking operations, state changes - classified as transfer with note
  if (isZero && (fundFlow.hasContractInteraction || fundFlow.hasTokenTransfers)) {
    return {
      note: {
        message: `Contract interaction with zero value. May be approval, staking, or other state change.`,
        metadata: {
          hasContractInteraction: fundFlow.hasContractInteraction,
          hasTokenTransfers: fundFlow.hasTokenTransfers,
        },
        severity: 'info',
        type: 'contract_interaction',
      },
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
      note: {
        message: fundFlow.classificationUncertainty,
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'info',
        type: 'classification_uncertain',
      },
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Ultimate fallback: Couldn't match any confident pattern
  return {
    note: {
      message: 'Unable to determine transaction classification using confident patterns.',
      metadata: {
        inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
        outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
      },
      severity: 'warning',
      type: 'classification_failed',
    },
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
  };
}
