import { isFiat, type Currency } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type {
  AccountingScopedBuildResult,
  AccountingScopedTransaction,
} from '../matching/build-cost-basis-scoped-transactions.js';

const logger = getLogger('cost-basis.standard.validation.price');

/**
 * Represents a movement or fee that requires a price for cost basis calculation
 */
interface PricedEntity {
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

type PricedEntityKind = PricedEntity['kind'];

interface PriceBearingEntry {
  assetSymbol: string;
  priceAtTxTime?:
    | {
        fxRateToUSD?: { toFixed(): string } | undefined;
        fxSource?: string | undefined;
        fxTimestamp?: Date | undefined;
        price?:
          | {
              amount?: unknown;
              currency?: string | undefined;
            }
          | undefined;
      }
    | undefined;
}

/**
 * Validation issue found during price preflight checks
 */
interface PriceValidationIssue {
  entity: PricedEntity;
  issueType: 'missing_price' | 'non_usd_currency' | 'missing_fx_trail';
  message: string;
}

/**
 * Aggregated validation results
 */
interface PriceValidationResult {
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
 * Extract all scoped movements and fees that still require pricing.
 */
function collectScopedPricedEntities(scopedTransactions: AccountingScopedTransaction[]): PricedEntity[] {
  const entities: PricedEntity[] = [];

  for (const scopedTransaction of scopedTransactions) {
    const datetime = scopedTransaction.tx.datetime ?? '(unknown)';
    appendPricedEntities(
      entities,
      scopedTransaction.tx.txFingerprint,
      datetime,
      'inflow',
      scopedTransaction.movements.inflows
    );
    appendPricedEntities(
      entities,
      scopedTransaction.tx.txFingerprint,
      datetime,
      'outflow',
      scopedTransaction.movements.outflows
    );
    appendPricedEntities(entities, scopedTransaction.tx.txFingerprint, datetime, 'fee', scopedTransaction.fees);
  }

  return entities;
}

function appendPricedEntities(
  target: PricedEntity[],
  transactionId: string,
  datetime: string,
  kind: PricedEntityKind,
  entries: readonly PriceBearingEntry[]
): void {
  for (const entry of entries) {
    target.push(buildPricedEntity(transactionId, datetime, kind, entry));
  }
}

function buildPricedEntity(
  transactionId: string,
  datetime: string,
  kind: PricedEntityKind,
  entry: PriceBearingEntry
): PricedEntity {
  const priceData = entry.priceAtTxTime;

  return {
    transactionId,
    datetime,
    assetSymbol: entry.assetSymbol,
    currency: priceData?.price?.currency,
    kind,
    hasPrice: hasPriceData(priceData),
    hasFxMetadata: hasCompleteFxMetadata(priceData),
    fxMetadata: buildFxMetadata(priceData),
  };
}

function hasPriceData(priceData: PriceBearingEntry['priceAtTxTime']): boolean {
  return Boolean(priceData?.price?.amount && priceData?.price?.currency);
}

function hasCompleteFxMetadata(priceData: PriceBearingEntry['priceAtTxTime']): boolean {
  return Boolean(priceData?.fxRateToUSD && priceData.fxSource && priceData.fxTimestamp);
}

function buildFxMetadata(priceData: PriceBearingEntry['priceAtTxTime']): PricedEntity['fxMetadata'] {
  if (!priceData || (!priceData.fxRateToUSD && !priceData.fxSource && !priceData.fxTimestamp)) {
    return undefined;
  }

  return {
    rate: priceData.fxRateToUSD?.toFixed() ?? '',
    source: priceData.fxSource ?? '',
    timestamp: priceData.fxTimestamp?.toISOString() ?? '',
  };
}

/**
 * Find entities with missing prices
 * Pure function - no side effects
 *
 * Note: Fiat currencies are excluded from validation as they don't need prices
 * (they represent the base monetary value)
 */
function validatePriceCompleteness(entities: PricedEntity[]): PriceValidationIssue[] {
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
function validatePriceCurrency(entities: PricedEntity[]): PriceValidationIssue[] {
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
function validateFxAuditTrail(entities: PricedEntity[]): PriceValidationIssue[] {
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
function formatValidationError(result: PriceValidationResult): string {
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
 * Assert that the scoped accounting boundary has complete, USD-denominated price data.
 */
export function assertScopedPriceDataQuality(scopedBuildResult: AccountingScopedBuildResult): Result<void, Error> {
  return assertEntityPriceDataQuality(collectScopedPricedEntities(scopedBuildResult.transactions));
}

function assertEntityPriceDataQuality(entities: PricedEntity[]): Result<void, Error> {
  const result = buildPriceValidationResult(entities);
  if (!result.isValid) {
    return err(new Error(formatValidationError(result)));
  }

  return ok(undefined);
}

function buildPriceValidationResult(entities: PricedEntity[]): PriceValidationResult {
  const missingPriceIssues = validatePriceCompleteness(entities);
  const nonUsdIssues = validatePriceCurrency(entities);
  const missingFxTrailIssues = validateFxAuditTrail(entities);
  const allIssues = [...missingPriceIssues, ...nonUsdIssues, ...missingFxTrailIssues];
  const { byCurrency, byKind } = buildEntitySummaries(entities);

  return {
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
}

function buildEntitySummaries(entities: PricedEntity[]): {
  byCurrency: Map<string, number>;
  byKind: Map<string, number>;
} {
  const byKind = new Map<string, number>();
  const byCurrency = new Map<string, number>();

  for (const entity of entities) {
    byKind.set(entity.kind, (byKind.get(entity.kind) ?? 0) + 1);
    if (entity.currency) {
      byCurrency.set(entity.currency, (byCurrency.get(entity.currency) ?? 0) + 1);
    }
  }

  return { byKind, byCurrency };
}
