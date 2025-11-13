/**
 * Pure utility functions for price enrichment logic
 *
 * This module contains the business logic for:
 * - Multi-pass price inference (exchange-execution, derived ratios, swap recalculation)
 * - Link-based price propagation across platforms
 * - Fee price enrichment from movement prices
 *
 * All functions are pure (no side effects, no DB access, no logging).
 */

import type { AssetMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';

import { enrichMovementsWithPrices } from './movement-enrichment-utils.js';
import { calculatePriceFromTrade, extractTradeMovements, stampFiatIdentityPrices } from './price-calculation-utils.js';
import type { TransactionGroup } from './types.js';

/**
 * Result of multi-pass price inference
 */
export interface InferMultiPassResult {
  /** Enriched transactions with derived prices */
  transactions: UniversalTransaction[];
  /** IDs of transactions modified by ratio recalculation (Pass N+2) */
  modifiedIds: Set<number>;
}

/**
 * Internal result structure for individual passes
 */
interface PassResult {
  /** Map of transaction ID to enriched movements */
  enrichedMovements: Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>;
  /** IDs of transactions modified by this pass */
  modifiedIds: Set<number>;
}

/**
 * Result of link-based price propagation
 */
export interface PropagatePricesResult {
  /** Enriched transactions with propagated prices */
  enrichedTransactions: UniversalTransaction[];
  /** IDs of transactions modified by link propagation */
  modifiedIds: Set<number>;
}

/**
 * Pass 0: Apply prices from fiat trades and stamp identity prices on fiat movements
 *
 * Two sub-passes:
 * 1. Process simple trades (1 inflow + 1 outflow) where one side is fiat currency:
 *    - USD trades: Get 'exchange-execution' source (priority 3 - highest, already in USD)
 *    - Non-USD fiat trades (CAD/EUR/etc): Get 'fiat-execution-tentative' source (priority 0 - lowest)
 *      → Stage 1 upgrades to 'derived-ratio' (priority 2) upon successful normalization
 *      → If normalization fails, Stage 3 providers (priority 1) can overwrite
 * 2. Stamp identity prices on any remaining fiat movements (deposits, withdrawals, fees)
 *
 * @param transactions - Transactions to process
 * @returns PassResult with enriched movements (no modifiedIds tracking for Pass 0)
 */
function applyExchangeExecutionPrices(transactions: UniversalTransaction[]): PassResult {
  const enrichedMovements = new Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>();

  for (const tx of transactions) {
    const timestamp = new Date(tx.datetime).getTime();
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];

    // Sub-pass 1: Handle trade pricing
    const trade = extractTradeMovements(inflows, outflows, timestamp);
    let currentInflows = inflows;
    let currentOutflows = outflows;

    if (trade) {
      const tradePrices = calculatePriceFromTrade(trade);

      if (tradePrices.length > 0) {
        const pricesMap = new Map(tradePrices.map((p) => [p.asset, p.priceAtTxTime]));
        currentInflows = enrichMovementsWithPrices(inflows, pricesMap);
        currentOutflows = enrichMovementsWithPrices(outflows, pricesMap);
      }
    }

    // Sub-pass 2: Stamp identity prices on any remaining unpriced fiat movements
    const allMovements = [...currentInflows, ...currentOutflows];
    const fiatIdentityPrices = stampFiatIdentityPrices(allMovements, timestamp);

    if (fiatIdentityPrices.length > 0) {
      const fiatPricesMap = new Map(fiatIdentityPrices.map((p) => [p.asset, p.priceAtTxTime]));
      currentInflows = enrichMovementsWithPrices(currentInflows, fiatPricesMap);
      currentOutflows = enrichMovementsWithPrices(currentOutflows, fiatPricesMap);
    }

    // Only store if we modified something
    if (currentInflows !== inflows || currentOutflows !== outflows) {
      enrichedMovements.set(tx.id, {
        inflows: currentInflows,
        outflows: currentOutflows,
      });
    }
  }

  return {
    enrichedMovements,
    modifiedIds: new Set(), // Pass 0 doesn't track modifications
  };
}

/**
 * Pass 1: Derive inflow prices from outflows when only outflow has price
 *
 * Handles cases where price providers lack data for exotic assets, but we can
 * calculate their price from the swap ratio.
 *
 * @param transactions - Transactions to process
 * @param previousMovements - Enriched movements from previous pass
 * @returns PassResult with updated movements and modification tracking
 */
function deriveInflowPricesFromOutflows(
  transactions: UniversalTransaction[],
  previousMovements: Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>
): PassResult {
  const enrichedMovements = new Map(previousMovements);
  const modifiedIds = new Set<number>();

  for (const tx of transactions) {
    const enriched = enrichedMovements.get(tx.id);
    const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
    const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
    const timestamp = new Date(tx.datetime).getTime();

    const trade = extractTradeMovements(inflows, outflows, timestamp);
    if (!trade) {
      continue;
    }

    // Only process if outflow has price but inflow doesn't
    if (trade.inflow.priceAtTxTime || !trade.outflow.priceAtTxTime) {
      continue;
    }

    // Calculate inflow price from outflow using swap ratio
    const ratio = trade.outflow.grossAmount.dividedBy(trade.inflow.grossAmount);
    const derivedPrice = trade.outflow.priceAtTxTime.price.amount.times(ratio);

    const ratioPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [
      {
        asset: trade.inflow.asset.toString(),
        priceAtTxTime: {
          price: {
            amount: derivedPrice,
            currency: trade.outflow.priceAtTxTime.price.currency,
          },
          source: 'derived-ratio',
          fetchedAt: new Date(timestamp),
          granularity: trade.outflow.priceAtTxTime.granularity,
        },
      },
    ];

    const pricesMap = new Map(ratioPrices.map((p) => [p.asset, p.priceAtTxTime]));
    const updatedInflows = enrichMovementsWithPrices(inflows, pricesMap);

    enrichedMovements.set(tx.id, {
      inflows: updatedInflows,
      outflows,
    });

    modifiedIds.add(tx.id);
  }

  return { enrichedMovements, modifiedIds };
}

/**
 * Pass N+2: Recalculate crypto-crypto swap ratios
 *
 * When both sides of a trade have prices but neither is fiat, recalculate the
 * inflow (acquisition) side from the outflow (disposal) side using the swap ratio.
 * This ensures we use execution price, not market price, for cost basis.
 *
 * @param transactions - Transactions to process
 * @param previousMovements - Enriched movements from previous pass
 * @returns PassResult with updated movements and modification tracking
 */
function recalculateCryptoSwapRatios(
  transactions: UniversalTransaction[],
  previousMovements: Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>
): PassResult {
  const enrichedMovements = new Map(previousMovements);
  const modifiedIds = new Set<number>();

  for (const tx of transactions) {
    const enriched = enrichedMovements.get(tx.id);
    const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
    const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
    const timestamp = new Date(tx.datetime).getTime();

    const trade = extractTradeMovements(inflows, outflows, timestamp);
    if (!trade) {
      continue;
    }

    // Both sides must have prices
    if (!trade.inflow.priceAtTxTime || !trade.outflow.priceAtTxTime) {
      continue;
    }

    // Check if this is a crypto-crypto swap (neither side is fiat/stable)
    const inflowCurrency = trade.inflow.asset;
    const outflowCurrency = trade.outflow.asset;

    if (inflowCurrency.isFiatOrStablecoin() || outflowCurrency.isFiatOrStablecoin()) {
      continue; // Keep fiat-based prices (they're already execution prices)
    }

    // Both are crypto: recalculate inflow from outflow using swap ratio
    // We trust the outflow price (disposal side) as it should be FMV from fetch
    // Then calculate inflow (acquisition) from the ratio
    const ratio = parseDecimal(trade.outflow.grossAmount.toFixed()).dividedBy(
      parseDecimal(trade.inflow.grossAmount.toFixed())
    );
    const derivedPrice = parseDecimal(trade.outflow.priceAtTxTime.price.amount.toFixed()).times(ratio);

    const ratioPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [
      {
        asset: trade.inflow.asset.toString(),
        priceAtTxTime: {
          price: {
            amount: derivedPrice,
            currency: trade.outflow.priceAtTxTime.price.currency,
          },
          source: 'derived-ratio',
          fetchedAt: new Date(timestamp),
          granularity: trade.outflow.priceAtTxTime.granularity,
        },
      },
    ];

    // Priority system automatically overwrites fetched prices with derived-ratio (priority 2)
    const pricesMap = new Map(ratioPrices.map((p) => [p.asset, p.priceAtTxTime]));
    const updatedInflows = enrichMovementsWithPrices(inflows, pricesMap);

    enrichedMovements.set(tx.id, {
      inflows: updatedInflows,
      outflows, // Keep outflow prices (disposal FMV)
    });

    modifiedIds.add(tx.id);
  }

  return { enrichedMovements, modifiedIds };
}

/**
 * Apply direct price enrichment using multi-pass inference
 *
 * This implements a three-pass algorithm:
 * - Pass 0: Apply exchange-execution prices from fiat/stable trades to their source movements
 * - Pass 1: Derive inflow prices from outflows when only outflow has price
 * - Pass N+2: Recalculate crypto-crypto swap ratios using fetched prices
 *
 * @param transactions - Transactions to enrich (should be sorted chronologically)
 * @returns Result with enriched transactions and IDs of modified transactions
 */
export function inferMultiPass(transactions: UniversalTransaction[]): InferMultiPassResult {
  // Execute each pass sequentially, building on previous results
  const pass0 = applyExchangeExecutionPrices(transactions);
  const pass1 = deriveInflowPricesFromOutflows(transactions, pass0.enrichedMovements);
  const pass2 = recalculateCryptoSwapRatios(transactions, pass1.enrichedMovements);

  // Merge enriched movements back into transactions
  const enrichedTransactions = transactions.map((tx) => {
    const enriched = pass2.enrichedMovements.get(tx.id);
    if (enriched) {
      return {
        ...tx,
        movements: {
          inflows: enriched.inflows,
          outflows: enriched.outflows,
        },
      };
    }
    return tx;
  });

  // Combine modification IDs from Pass 1 and Pass 2 (Pass 0 doesn't track)
  const modifiedIds = new Set([...pass1.modifiedIds, ...pass2.modifiedIds]);

  return {
    transactions: enrichedTransactions,
    modifiedIds,
  };
}

/**
 * Propagate prices across confirmed transaction links
 *
 * This enables cross-platform price flow:
 * - Exchange withdrawal → Blockchain deposit
 * - Blockchain transfer → Blockchain receive
 * - Exchange withdrawal → Exchange deposit
 *
 * Logic:
 * 1. For each confirmed link, find source and target transactions
 * 2. Match movements by asset (source outflow → target inflow)
 * 3. Copy price from source movement to target movement
 * 4. Set source to 'link-propagated'
 *
 * @param group - Transaction group with linkChain
 * @param transactions - All transactions in the group
 * @returns Result with enriched transactions and IDs of modified transactions
 */
export function propagatePricesAcrossLinks(
  group: TransactionGroup,
  transactions: UniversalTransaction[]
): PropagatePricesResult {
  const { linkChain } = group;

  // Build transaction lookup map for fast access
  const txMap = new Map(transactions.map((tx) => [tx.id, tx]));

  // Track enriched movements for each transaction
  const enrichedMovements = new Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>();

  for (const link of linkChain) {
    const sourceTx = txMap.get(link.sourceTransactionId);
    const targetTx = txMap.get(link.targetTransactionId);

    if (!sourceTx || !targetTx) {
      // Link references transactions not in group, skip
      continue;
    }

    // Match movements: source outflows → target inflows
    const sourceOutflows = sourceTx.movements.outflows ?? [];
    const targetInflows = targetTx.movements.inflows ?? [];

    // Track which target movements got prices
    const targetMovementPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

    for (const sourceMovement of sourceOutflows) {
      // Skip if source movement doesn't have a price
      if (!sourceMovement.priceAtTxTime) {
        continue;
      }

      // Find matching target movement by asset
      for (const targetMovement of targetInflows) {
        if (targetMovement.asset.toString() === sourceMovement.asset.toString()) {
          // Check if amounts are reasonably close (allow up to 10% difference for fees)
          const sourceAmount = sourceMovement.grossAmount.toNumber();
          const targetAmount = targetMovement.grossAmount.toNumber();
          const amountDiff = Math.abs(sourceAmount - targetAmount);
          const amountTolerance = sourceAmount * 0.1; // 10% tolerance

          if (amountDiff <= amountTolerance) {
            // Propagate price with 'link-propagated' source
            const propagatedPrice: PriceAtTxTime = {
              ...sourceMovement.priceAtTxTime,
              source: 'link-propagated',
            };

            targetMovementPrices.push({
              asset: targetMovement.asset.toString(),
              priceAtTxTime: propagatedPrice,
            });

            // Only match each target movement once
            break;
          }
        }
      }
    }

    // Apply propagated prices to target transaction movements
    // Priority system automatically handles overwriting (link-propagated has priority 2)
    if (targetMovementPrices.length > 0) {
      const pricesMap = new Map(targetMovementPrices.map((p) => [p.asset, p.priceAtTxTime]));
      const enrichedInflows = enrichMovementsWithPrices(targetInflows, pricesMap);
      const targetOutflows = targetTx.movements.outflows ?? [];

      enrichedMovements.set(targetTx.id, {
        inflows: enrichedInflows,
        outflows: targetOutflows,
      });
    }
  }

  // Return enriched transactions (with link-propagated prices applied)
  const enrichedTransactions = transactions.map((tx) => {
    const enriched = enrichedMovements.get(tx.id);
    if (enriched) {
      return {
        ...tx,
        movements: {
          inflows: enriched.inflows,
          outflows: enriched.outflows,
        },
      };
    }
    return tx;
  });

  // Return modified transaction IDs (those that got link-propagated prices)
  const modifiedIds = new Set(enrichedMovements.keys());

  return {
    enrichedTransactions,
    modifiedIds,
  };
}

/**
 * Enrich fee movements with prices from regular movements
 *
 * Since fees occur at the same timestamp as the transaction, we can copy prices
 * from inflows/outflows that share the same asset. For fiat fees that still don't
 * have prices after copying, stamp identity prices.
 *
 * @param transactions - Transactions to enrich
 * @returns Transactions with enriched fee prices
 */
export function enrichFeePricesFromMovements(transactions: UniversalTransaction[]): UniversalTransaction[] {
  return transactions.map((tx) => {
    const timestamp = new Date(tx.datetime).getTime();
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];
    const allMovements = [...inflows, ...outflows];

    // Build price lookup map by asset from movements
    const pricesByAsset = new Map<string, PriceAtTxTime>();
    for (const movement of allMovements) {
      if (movement.priceAtTxTime && !pricesByAsset.has(movement.asset.toString())) {
        pricesByAsset.set(movement.asset.toString(), movement.priceAtTxTime);
      }
    }

    // Process fees array instead of fees.platform/fees.network
    const fees = tx.fees ?? [];
    if (fees.length === 0) {
      return tx; // No fees to enrich
    }

    let feesModified = false;
    const enrichedFees = fees.map((fee) => {
      // Skip if fee already has price
      if (fee.priceAtTxTime) {
        return fee;
      }

      // Try to copy price from movement with same asset
      const price = pricesByAsset.get(fee.asset.toString());
      if (price) {
        feesModified = true;
        return { ...fee, priceAtTxTime: price };
      }

      return fee;
    });

    // Stamp identity prices on any remaining fiat fees
    const finalFees = enrichedFees.map((fee) => {
      // Skip if already has price
      if (fee.priceAtTxTime) {
        return fee;
      }

      // Check if this is a fiat currency
      try {
        if (!fee.asset.isFiat()) {
          return fee;
        }

        const isUSD = fee.asset.toString() === 'USD';
        feesModified = true;

        return {
          ...fee,
          priceAtTxTime: {
            price: { amount: parseDecimal('1'), currency: fee.asset },
            // USD gets 'exchange-execution' (final), non-USD gets 'fiat-execution-tentative' (will be normalized)
            source: isUSD ? 'exchange-execution' : 'fiat-execution-tentative',
            fetchedAt: new Date(timestamp),
            granularity: 'exact' as const,
          },
        };
      } catch {
        // Not a valid currency, skip
        return fee;
      }
    });

    // Return transaction with enriched fees if any changed
    if (feesModified) {
      return { ...tx, fees: finalFees };
    }

    return tx;
  });
}
