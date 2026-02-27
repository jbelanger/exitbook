import { isFiat, type Currency, type UniversalTransactionData } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

const logger = getLogger('cost-basis-validation-utils');

/**
 * Represents a movement or fee that requires a price for cost basis calculation
 */
export interface PricedEntity {
  transactionId: string;
  datetime: string;
  assetSymbol: string;
  currency: string | undefined;
  kind: 'inflow' | 'outflow' | 'fee';
  hasPrice: boolean;
  hasFxMetadata: boolean;
  fxMetadata?:
    | {
        rate: string;
        source: string;
        timestamp: string;
      }
    | undefined;
}

/**
 * Validation issue found during price preflight checks
 */
export interface PriceValidationIssue {
  entity: PricedEntity;
  issueType: 'missing_price' | 'non_usd_currency' | 'missing_fx_trail';
  message: string;
}

/**
 * Aggregated validation results
 */
export interface PriceValidationResult {
  isValid: boolean;
  issues: PriceValidationIssue[];
  summary: {
    byCurrency: Map<string, number>;
    byKind: Map<string, number>;
    missingFxTrails: number;
    missingPrices: number;
    nonUsdPrices: number;
    totalEntities: number;
  };
}

/**
 * Extract all entities (movements and fees) that need pricing for cost basis calculation
 * Pure function - no side effects
 */
export function collectPricedEntities(transactions: UniversalTransactionData[]): PricedEntity[] {
  const entities: PricedEntity[] = [];

  for (const tx of transactions) {
    const txId = String(tx.id ?? tx.externalId ?? '(unknown)');
    const datetime = tx.datetime ?? '(unknown)';

    // Collect inflows
    for (const movement of tx.movements?.inflows ?? []) {
      const priceData = movement.priceAtTxTime;
      const hasPrice = Boolean(priceData?.price?.amount && priceData?.price?.currency);
      const hasFxMetadata = priceData
        ? Boolean(priceData.fxRateToUSD && priceData.fxSource && priceData.fxTimestamp)
        : false;

      entities.push({
        transactionId: txId,
        datetime,
        assetSymbol: movement.assetSymbol,
        currency: priceData?.price?.currency,
        kind: 'inflow',
        hasPrice,
        hasFxMetadata,
        fxMetadata:
          priceData && (priceData.fxRateToUSD || priceData.fxSource || priceData.fxTimestamp)
            ? {
                rate: priceData.fxRateToUSD?.toFixed() ?? '',
                source: priceData.fxSource ?? '',
                timestamp: priceData.fxTimestamp?.toISOString() ?? '',
              }
            : undefined,
      });
    }

    // Collect outflows
    for (const movement of tx.movements?.outflows ?? []) {
      const priceData = movement.priceAtTxTime;
      const hasPrice = Boolean(priceData?.price?.amount && priceData?.price?.currency);
      const hasFxMetadata = priceData
        ? Boolean(priceData.fxRateToUSD && priceData.fxSource && priceData.fxTimestamp)
        : false;

      entities.push({
        transactionId: txId,
        datetime,
        assetSymbol: movement.assetSymbol,
        currency: priceData?.price?.currency,
        kind: 'outflow',
        hasPrice,
        hasFxMetadata,
        fxMetadata:
          priceData && (priceData.fxRateToUSD || priceData.fxSource || priceData.fxTimestamp)
            ? {
                rate: priceData.fxRateToUSD?.toFixed() ?? '',
                source: priceData.fxSource ?? '',
                timestamp: priceData.fxTimestamp?.toISOString() ?? '',
              }
            : undefined,
      });
    }

    // Collect fees
    for (const fee of tx.fees ?? []) {
      const priceData = fee.priceAtTxTime;
      const hasPrice = Boolean(priceData?.price?.amount && priceData?.price?.currency);
      const hasFxMetadata = priceData
        ? Boolean(priceData.fxRateToUSD && priceData.fxSource && priceData.fxTimestamp)
        : false;

      entities.push({
        transactionId: txId,
        datetime,
        assetSymbol: fee.assetSymbol,
        currency: priceData?.price?.currency,
        kind: 'fee',
        hasPrice,
        hasFxMetadata,
        fxMetadata:
          priceData && (priceData.fxRateToUSD || priceData.fxSource || priceData.fxTimestamp)
            ? {
                rate: priceData.fxRateToUSD?.toFixed() ?? '',
                source: priceData.fxSource ?? '',
                timestamp: priceData.fxTimestamp?.toISOString() ?? '',
              }
            : undefined,
      });
    }
  }

  return entities;
}

/**
 * Find entities with missing prices
 * Pure function - no side effects
 *
 * Note: Fiat currencies are excluded from validation as they don't need prices
 * (they represent the base monetary value)
 */
export function validatePriceCompleteness(entities: PricedEntity[]): PriceValidationIssue[] {
  return entities
    .filter((e) => {
      // Skip entities that already have prices
      if (e.hasPrice) {
        return false;
      }

      // Skip fiat currencies - they don't need prices for cost basis calculation
      try {
        const currency = e.assetSymbol as Currency;
        if (isFiat(currency)) {
          return false;
        }
      } catch (error) {
        logger.warn(
          { error, assetSymbol: e.assetSymbol },
          'Failed to create Currency, assuming crypto and checking price requirement'
        );
        // If currency creation fails, treat as crypto (needs price)
      }

      return true;
    })
    .map((entity) => ({
      entity,
      issueType: 'missing_price' as const,
      message: `Missing price for ${entity.kind} ${entity.assetSymbol} in transaction ${entity.transactionId}`,
    }));
}

/**
 * Find entities with non-USD prices
 * Pure function - no side effects
 */
export function validatePriceCurrency(entities: PricedEntity[]): PriceValidationIssue[] {
  return entities
    .filter((e) => e.hasPrice && e.currency?.trim().toUpperCase() !== 'USD')
    .map((entity) => ({
      entity,
      issueType: 'non_usd_currency' as const,
      message: `Price in ${entity.currency} instead of USD for ${entity.kind} ${entity.assetSymbol} in transaction ${entity.transactionId}`,
    }));
}

/**
 * Find entities where price was converted from non-USD fiat but missing FX audit trail
 * Pure function - no side effects
 */
export function validateFxAuditTrail(entities: PricedEntity[]): PriceValidationIssue[] {
  return entities
    .filter((e) => {
      // Only validate entities that have FX metadata present but incomplete
      if (!e.fxMetadata) {
        return false;
      }
      // If fx metadata exists but is incomplete, flag it
      return !e.hasFxMetadata;
    })
    .map((entity) => ({
      entity,
      issueType: 'missing_fx_trail' as const,
      message: `Incomplete FX audit trail for ${entity.kind} ${entity.assetSymbol} in transaction ${entity.transactionId}`,
    }));
}

/**
 * Format validation results into human-readable error message
 * Pure function - no side effects
 */
export function formatValidationError(result: PriceValidationResult): string {
  const problems: string[] = [];

  // Missing prices
  if (result.summary.missingPrices > 0) {
    const kindBreakdown = Array.from(result.summary.byKind.entries())
      .filter(([kind]) => {
        return result.issues.filter((i) => i.issueType === 'missing_price' && i.entity.kind === kind).length > 0;
      })
      .map(([kind, _count]) => {
        const missingCount = result.issues.filter(
          (i) => i.issueType === 'missing_price' && i.entity.kind === kind
        ).length;
        return `${missingCount} ${kind}`;
      })
      .join(', ');

    problems.push(`• ${result.summary.missingPrices} price(s) missing (${kindBreakdown})`);
  }

  // Non-USD prices
  if (result.summary.nonUsdPrices > 0) {
    const currencyBreakdown = Array.from(result.summary.byCurrency.entries())
      .filter(([cur]) => cur !== 'USD')
      .map(([cur, _count]) => {
        const nonUsdCount = result.issues.filter(
          (i) => i.issueType === 'non_usd_currency' && i.entity.currency === cur
        ).length;
        return `${nonUsdCount} ${cur}`;
      })
      .join(', ');

    problems.push(`• ${result.summary.nonUsdPrices} price(s) not in USD (${currencyBreakdown})`);
  }

  // Missing FX trails
  if (result.summary.missingFxTrails > 0) {
    problems.push(
      `• ${result.summary.missingFxTrails} normalized price(s) missing complete FX audit trail (fxRateToUSD/fxSource/fxTimestamp)`
    );
  }

  // Format examples (up to 5 from different issue types)
  // If only one issue type exists, show up to 5 examples
  // If multiple issue types exist, show up to 2 per type (capped at 5 total)
  const issueTypes = new Set(result.issues.map((i) => i.issueType));
  const examplesPerType = issueTypes.size === 1 ? 5 : 2;

  const exampleIssues = [
    ...result.issues.filter((i) => i.issueType === 'missing_price').slice(0, examplesPerType),
    ...result.issues.filter((i) => i.issueType === 'non_usd_currency').slice(0, examplesPerType),
    ...result.issues.filter((i) => i.issueType === 'missing_fx_trail').slice(0, examplesPerType),
  ].slice(0, 5);

  const examples = exampleIssues
    .map((issue) => {
      const e = issue.entity;
      return `  - Tx ${e.transactionId} (${e.datetime}) [${e.kind}] ${e.assetSymbol} | Currency: ${e.currency ?? 'none'} | FX: ${e.hasFxMetadata ? 'complete' : e.fxMetadata ? 'incomplete' : 'none'}`;
    })
    .join('\n');

  return (
    `Price preflight validation failed:\n${problems.join('\n')}\n\n` +
    `Run 'prices enrich' to:\n` +
    `  1. Fetch missing prices from price providers\n` +
    `  2. Normalize all prices to USD\n` +
    `  3. Add FX audit trail metadata for converted prices\n\n` +
    `Examples of issues found:\n${examples}`
  );
}

/**
 * Assert that all transactions have complete, USD-denominated price data.
 * Hard-fail: any missing, non-USD, or incomplete FX-trail price returns an error.
 * Used as a pre-condition inside CostBasisCalculator (defense-in-depth after the
 * soft-filtering done by validateTransactionPrices in cost-basis/cost-basis-utils.ts).
 *
 * @param transactions - Transactions to validate (should already be price-filtered)
 * @returns Result containing void on success, or Error with formatted message on failure
 */
export function assertPriceDataQuality(transactions: UniversalTransactionData[]): Result<void, Error> {
  // Phase 1: Collect all entities
  const entities = collectPricedEntities(transactions);

  // Phase 2: Run all validations
  const missingPriceIssues = validatePriceCompleteness(entities);
  const nonUsdIssues = validatePriceCurrency(entities);
  const missingFxTrailIssues = validateFxAuditTrail(entities);

  // Phase 3: Aggregate results
  const allIssues = [...missingPriceIssues, ...nonUsdIssues, ...missingFxTrailIssues];

  const byKind = new Map<string, number>();
  const byCurrency = new Map<string, number>();

  for (const entity of entities) {
    byKind.set(entity.kind, (byKind.get(entity.kind) ?? 0) + 1);
    if (entity.currency) {
      byCurrency.set(entity.currency, (byCurrency.get(entity.currency) ?? 0) + 1);
    }
  }

  const result: PriceValidationResult = {
    isValid: allIssues.length === 0,
    issues: allIssues,
    summary: {
      totalEntities: entities.length,
      missingPrices: missingPriceIssues.length,
      nonUsdPrices: nonUsdIssues.length,
      missingFxTrails: missingFxTrailIssues.length,
      byKind,
      byCurrency,
    },
  };

  // Phase 4: Return result
  if (!result.isValid) {
    return err(new Error(formatValidationError(result)));
  }

  return ok();
}
