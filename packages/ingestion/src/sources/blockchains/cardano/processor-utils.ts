import type { CardanoTransaction } from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import type { ProcessingContext } from '../../../core/types/processors.ts';

import type { CardanoFundFlow, CardanoMovement } from './types.js';

const logger = getLogger('cardano-processor-utils');

/**
 * Convert lovelace (smallest unit) to ADA
 * 1 ADA = 1,000,000 lovelace
 */
export function convertLovelaceToAda(lovelace: string): string {
  const lovelaceDecimal = parseDecimal(lovelace);
  return lovelaceDecimal.dividedBy(1_000_000).toFixed();
}

/**
 * Parse Cardano asset unit identifier
 * - ADA: 'lovelace'
 * - Native tokens: 'policyId' + 'assetName' (concatenated hex strings)
 */
export function parseCardanoAssetUnit(unit: string): {
  assetName?: string | undefined;
  isAda: boolean;
  policyId?: string | undefined;
} {
  if (unit === 'lovelace') {
    return { isAda: true };
  }

  // Native token format: policyId (56 hex chars) + optional assetName (hex)
  // Policy ID is always 56 characters (28 bytes in hex)
  if (unit.length >= 56) {
    const policyId = unit.slice(0, 56);
    const assetName = unit.length > 56 ? unit.slice(56) : undefined;

    return {
      assetName,
      isAda: false,
      policyId,
    };
  }

  // Fallback: treat as unknown token
  return {
    isAda: false,
    policyId: unit,
  };
}

/**
 * Consolidate duplicate assets by summing amounts
 */
export function consolidateCardanoMovements(movements: CardanoMovement[]): CardanoMovement[] {
  const assetMap = new Map<
    string,
    {
      amount: Decimal;
      assetName?: string | undefined;
      decimals?: number | undefined;
      policyId?: string | undefined;
      symbol?: string | undefined;
    }
  >();

  for (const movement of movements) {
    const existing = assetMap.get(movement.unit);
    if (existing) {
      existing.amount = existing.amount.plus(parseDecimal(movement.amount));
    } else {
      const entry: {
        amount: Decimal;
        assetName?: string | undefined;
        decimals?: number | undefined;
        policyId?: string | undefined;
        symbol?: string | undefined;
      } = {
        amount: parseDecimal(movement.amount),
        decimals: movement.decimals,
        policyId: movement.policyId,
        assetName: movement.assetName,
        symbol: movement.asset,
      };
      assetMap.set(movement.unit, entry);
    }
  }

  return Array.from(assetMap.entries()).map(([unit, data]) => ({
    amount: data.amount.toFixed(),
    asset: data.symbol || unit,
    assetName: data.assetName,
    decimals: data.decimals,
    policyId: data.policyId,
    unit,
  }));
}

/**
 * Normalize asset amount using decimals
 * For ADA (lovelace), decimals = 6 (1 ADA = 1,000,000 lovelace)
 * For native tokens, use provided decimals or default to 0 (no decimals)
 */
export function normalizeCardanoAmount(quantity: string, decimals: number | undefined): string {
  const quantityDecimal = parseDecimal(quantity);

  if (decimals === undefined || decimals === 0) {
    return quantityDecimal.toFixed();
  }

  const divisor = parseDecimal('10').pow(decimals);
  return quantityDecimal.dividedBy(divisor).toFixed();
}

/**
 * Check if a decimal string value is zero
 */
export function isZeroDecimal(value: string): boolean {
  try {
    return parseDecimal(value || '0').isZero();
  } catch (error) {
    logger.warn({ error, value }, 'Failed to parse decimal value, treating as zero');
    return true;
  }
}

/**
 * Analyze fund flow from normalized Cardano transaction data
 * Handles multi-asset UTXO model
 * Per-address UTXO model: only considers the single address being processed.
 */
export function analyzeCardanoFundFlow(
  tx: CardanoTransaction,
  context: ProcessingContext
): Result<CardanoFundFlow, string> {
  const userAddress = context.primaryAddress;
  // Per-address mode: only check this single address
  const addressSet = new Set<string>([userAddress]);

  const inflows: CardanoMovement[] = [];
  const outflows: CardanoMovement[] = [];

  // Track wallet involvement in inputs/outputs
  let userOwnsInput = false;
  let userReceivesOutput = false;

  // Analyze inputs (assets being spent)
  for (const input of tx.inputs) {
    const isUserInput = addressSet.has(input.address);

    if (isUserInput) {
      userOwnsInput = true;

      // Track all assets in this input as outflows
      for (const assetAmount of input.amounts) {
        const { isAda, policyId, assetName } = parseCardanoAssetUnit(assetAmount.unit);

        // Normalize amount using decimals
        // For ADA (lovelace), we use 6 decimals
        const decimals = isAda ? 6 : assetAmount.decimals;
        const normalizedAmount = normalizeCardanoAmount(assetAmount.quantity, decimals);

        if (isZeroDecimal(normalizedAmount)) {
          continue;
        }

        outflows.push({
          amount: normalizedAmount,
          asset: isAda ? 'ADA' : assetAmount.symbol || assetAmount.unit,
          assetName,
          decimals,
          policyId,
          unit: assetAmount.unit,
        });
      }
    }
  }

  // Analyze outputs (assets being received)
  for (const output of tx.outputs) {
    const isUserOutput = addressSet.has(output.address);

    if (isUserOutput) {
      userReceivesOutput = true;

      // Track all assets in this output as inflows
      for (const assetAmount of output.amounts) {
        const { isAda, policyId, assetName } = parseCardanoAssetUnit(assetAmount.unit);

        // Normalize amount using decimals
        const decimals = isAda ? 6 : assetAmount.decimals;
        const normalizedAmount = normalizeCardanoAmount(assetAmount.quantity, decimals);

        if (isZeroDecimal(normalizedAmount)) {
          continue;
        }

        inflows.push({
          amount: normalizedAmount,
          asset: isAda ? 'ADA' : assetAmount.symbol || assetAmount.unit,
          assetName,
          decimals,
          policyId,
          unit: assetAmount.unit,
        });
      }
    }
  }

  // Consolidate movements by asset
  const consolidatedInflows = consolidateCardanoMovements(inflows);
  const consolidatedOutflows = consolidateCardanoMovements(outflows);

  // Determine fee information
  // Fee is always paid in ADA and deducted from user's balance
  // feeAmount is already in ADA (converted from lovelace in the mapper)
  const feeAmount = tx.feeAmount || '0';
  const feePaidByUser = userOwnsInput && !isZeroDecimal(feeAmount);

  // ADR-005: For UTXO chains, preserve gross amounts (includes fee) in outflows.
  // The fee is recorded separately with settlement='on-chain', and the processor
  // will set netAmount = grossAmount - fee for ADA outflows.
  // Balance calculation subtracts grossAmount and ignores on-chain fees (already in gross).

  // Determine flow direction
  const isIncoming = userReceivesOutput && !userOwnsInput;
  const isOutgoing = userOwnsInput && !userReceivesOutput;

  // Determine primary addresses
  const fromAddress = isOutgoing
    ? tx.inputs.find((input) => addressSet.has(input.address))?.address
    : tx.inputs[0]?.address;

  const toAddress = isIncoming
    ? tx.outputs.find((output) => addressSet.has(output.address))?.address
    : tx.outputs[0]?.address;

  // Select primary asset (largest movement)
  let primary: CardanoMovement = {
    amount: '0',
    asset: 'ADA',
    unit: 'lovelace',
  };

  // Prioritize largest inflow
  const largestInflow = consolidatedInflows
    .sort((a, b) => {
      try {
        return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
      } catch (error) {
        logger.warn({ error, itemA: a, itemB: b }, 'Failed to parse amount during sort comparison, treating as equal');
        return 0;
      }
    })
    .find((inflow) => !isZeroDecimal(inflow.amount));

  if (largestInflow) {
    primary = { ...largestInflow };
  } else {
    // If no inflows, use largest outflow
    const largestOutflow = consolidatedOutflows
      .sort((a, b) => {
        try {
          return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
        } catch (error) {
          logger.warn(
            { error, itemA: a, itemB: b },
            'Failed to parse amount during sort comparison, treating as equal'
          );
          return 0;
        }
      })
      .find((outflow) => !isZeroDecimal(outflow.amount));

    if (largestOutflow) {
      primary = { ...largestOutflow };
    }
  }

  // Track uncertainty for complex transactions
  let classificationUncertainty: string | undefined;
  if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
    classificationUncertainty = `Complex multi-asset transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be a token swap or batch operation.`;
  }

  const fundFlow: CardanoFundFlow = {
    classificationUncertainty,
    feeAmount,
    feeCurrency: 'ADA',
    feePaidByUser,
    fromAddress,
    inflows: consolidatedInflows,
    inputCount: tx.inputs.length,
    isIncoming,
    isOutgoing,
    outflows: consolidatedOutflows,
    outputCount: tx.outputs.length,
    primary,
    toAddress,
  };

  return ok(fundFlow);
}

/**
 * Determine transaction type from fund flow analysis
 * Per-address UTXO model: returns generic 'transfer' type.
 *
 * Without derivedAddresses, we can't reliably distinguish:
 * - External deposit vs internal change receipt
 * - External withdrawal vs internal send to sibling address
 *
 * Solution: Use generic 'transfer' type for all UTXO movements.
 * Transaction linking can later provide semantic classification if needed.
 *
 * Note: operation_type is display metadata only - doesn't affect balance/cost basis calculations.
 */
export function determineCardanoTransactionType(_fundFlow: CardanoFundFlow): 'transfer' {
  return 'transfer';
}
