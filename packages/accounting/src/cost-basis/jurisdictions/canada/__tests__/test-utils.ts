import type { TransactionLink, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';
import { vi } from 'vitest';

import { buildTransaction, materializeTestTransaction } from '../../../../__tests__/test-utils.js';
import type { TaxAssetIdentityPolicy } from '../../../model/types.js';
import { buildCostBasisScopedTransactions } from '../../../standard/matching/build-cost-basis-scoped-transactions.js';
import { validateScopedTransferLinks } from '../../../standard/matching/validated-scoped-transfer-links.js';
import { getJurisdictionConfig } from '../../jurisdiction-configs.js';
import { buildCanadaTaxInputContext } from '../tax/canada-tax-context-builder.js';
import type {
  CanadaAcquisitionEvent,
  CanadaDispositionEvent,
  CanadaFeeAdjustmentEvent,
  CanadaTaxInputContext,
  CanadaTaxInputEvent,
  CanadaTaxValuation,
  CanadaTransferInEvent,
  CanadaTransferOutEvent,
} from '../tax/canada-tax-types.js';

export function createCanadaPriceRuntime(options?: {
  fiatToUsd?: Record<string, string>;
  usdToCad?: string;
}): IPriceProviderRuntime {
  const fetchPrice = vi.fn().mockImplementation(async ({ assetSymbol }: { assetSymbol: Currency }) => {
    const configuredRate = options?.fiatToUsd?.[assetSymbol];

    if (configuredRate) {
      return ok({
        price: parseDecimal(configuredRate),
        source: 'test-fiat-usd',
        fetchedAt: new Date('2024-01-15T00:00:00Z'),
      });
    }

    if (assetSymbol === ('CAD' as Currency) && options?.usdToCad) {
      return ok({
        price: parseDecimal('1').div(parseDecimal(options.usdToCad)),
        source: 'test-cad-usd',
        fetchedAt: new Date('2024-01-15T00:00:00Z'),
      });
    }

    return err(new Error(`Missing configured FX rate for ${assetSymbol}`));
  });

  return {
    fetchPrice,
    setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
    setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
    cleanup: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

export const noopLogger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
};

export { buildTransaction, materializeTestTransaction };

function computeScopedMovementFingerprint(
  transaction: Transaction,
  movementType: 'inflow' | 'outflow',
  position: number
): string {
  const materializedTransaction = materializeTestTransaction(transaction);
  const movement =
    movementType === 'inflow'
      ? materializedTransaction.movements.inflows?.[position]
      : materializedTransaction.movements.outflows?.[position];

  if (!movement) {
    throw new Error(`Transaction ${transaction.id} is missing ${movementType} movement at position ${position}`);
  }

  return movement.movementFingerprint;
}

export function createConfirmedTransferLink(params: {
  assetSymbol: Currency;
  id: number;
  linkType?: TransactionLink['linkType'];
  metadata?: TransactionLink['metadata'] | undefined;
  sourceAmount: string;
  sourceAssetId: string;
  sourcePosition?: number;
  sourceTransaction: Transaction;
  targetAmount: string;
  targetAssetId: string;
  targetPosition?: number;
  targetTransaction: Transaction;
}): TransactionLink {
  return {
    id: params.id,
    sourceTransactionId: params.sourceTransaction.id,
    targetTransactionId: params.targetTransaction.id,
    assetSymbol: params.assetSymbol,
    sourceAssetId: params.sourceAssetId,
    targetAssetId: params.targetAssetId,
    sourceAmount: parseDecimal(params.sourceAmount),
    targetAmount: parseDecimal(params.targetAmount),
    sourceMovementFingerprint: computeScopedMovementFingerprint(
      params.sourceTransaction,
      'outflow',
      params.sourcePosition ?? 0
    ),
    targetMovementFingerprint: computeScopedMovementFingerprint(
      params.targetTransaction,
      'inflow',
      params.targetPosition ?? 0
    ),
    linkType: params.linkType ?? 'exchange_to_blockchain',
    confidenceScore: parseDecimal('1'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('1'),
      timingValid: true,
      timingHours: 0,
    },
    status: 'confirmed',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export async function buildCanadaTestInputContext(
  transactions: Transaction[],
  confirmedLinks: TransactionLink[],
  priceRuntime: IPriceProviderRuntime,
  options?: {
    relaxedTaxIdentitySymbols?: readonly string[] | undefined;
    taxAssetIdentityPolicy?: TaxAssetIdentityPolicy | undefined;
  }
) {
  const canadaConfig = getJurisdictionConfig('CA');
  if (!canadaConfig) {
    throw new Error('Canada jurisdiction config is not registered');
  }

  const scopedResult = buildCostBasisScopedTransactions(transactions.map(materializeTestTransaction), noopLogger);
  const scoped = assertOk(scopedResult);
  const validatedLinksResult = validateScopedTransferLinks(scoped.transactions, confirmedLinks);
  const validatedLinks = assertOk(validatedLinksResult);

  return buildCanadaTaxInputContext({
    scopedTransactions: scoped.transactions,
    validatedTransfers: validatedLinks,
    feeOnlyInternalCarryovers: scoped.feeOnlyInternalCarryovers,
    priceRuntime,
    identityConfig: {
      taxAssetIdentityPolicy: options?.taxAssetIdentityPolicy ?? canadaConfig.taxAssetIdentityPolicy,
      relaxedTaxIdentitySymbols: options?.relaxedTaxIdentitySymbols ?? canadaConfig.relaxedTaxIdentitySymbols,
    },
  });
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function createBaseValuation(unitValueCad: string, quantity: string): CanadaTaxValuation {
  const unitCad = parseDecimal(unitValueCad);
  const qty = parseDecimal(quantity);

  return {
    taxCurrency: 'CAD',
    storagePriceAmount: unitCad,
    storagePriceCurrency: 'CAD' as Currency,
    quotedPriceAmount: unitCad,
    quotedPriceCurrency: 'CAD' as Currency,
    unitValueCad: unitCad,
    totalValueCad: unitCad.times(qty),
    valuationSource: 'stored-price',
  };
}

function buildEventBase(params: {
  assetId: string;
  assetIdentityKey?: string | undefined;
  assetSymbol: string;
  eventId: string;
  linkId?: number | undefined;
  movementFingerprint?: string | undefined;
  priceAtTxTime?: CanadaTaxInputEvent['priceAtTxTime'] | undefined;
  provenanceKind?: CanadaTaxInputEvent['provenanceKind'] | undefined;
  sourceMovementFingerprint?: string | undefined;
  sourceTransactionId?: number | undefined;
  targetMovementFingerprint?: string | undefined;
  timestamp: Date | string;
  transactionId: number;
  valuation: CanadaTaxValuation;
}) {
  const assetIdentityKey = params.assetIdentityKey ?? params.assetSymbol.toLowerCase();

  return {
    eventId: params.eventId,
    transactionId: params.transactionId,
    timestamp: toDate(params.timestamp),
    assetId: params.assetId,
    assetIdentityKey,
    taxPropertyKey: `ca:${assetIdentityKey}`,
    assetSymbol: params.assetSymbol as Currency,
    valuation: params.valuation,
    provenanceKind: params.provenanceKind ?? 'scoped-movement',
    linkId: params.linkId,
    movementFingerprint: params.movementFingerprint,
    priceAtTxTime: params.priceAtTxTime,
    sourceMovementFingerprint: params.sourceMovementFingerprint,
    sourceTransactionId: params.sourceTransactionId,
    targetMovementFingerprint: params.targetMovementFingerprint,
  };
}

export function createCanadaAcquisitionEvent(params: {
  assetId: string;
  assetIdentityKey?: string | undefined;
  assetSymbol: string;
  costBasisAdjustmentCad?: string | undefined;
  eventId: string;
  provenanceKind?: CanadaTaxInputEvent['provenanceKind'] | undefined;
  quantity: string;
  timestamp: Date | string;
  transactionId: number;
  unitValueCad: string;
}): CanadaAcquisitionEvent {
  const valuation = createBaseValuation(params.unitValueCad, params.quantity);

  return {
    ...buildEventBase({
      eventId: params.eventId,
      transactionId: params.transactionId,
      timestamp: params.timestamp,
      assetId: params.assetId,
      assetIdentityKey: params.assetIdentityKey,
      assetSymbol: params.assetSymbol,
      provenanceKind: params.provenanceKind,
      valuation,
    }),
    kind: 'acquisition',
    quantity: parseDecimal(params.quantity),
    costBasisAdjustmentCad:
      params.costBasisAdjustmentCad !== undefined ? parseDecimal(params.costBasisAdjustmentCad) : undefined,
  };
}

export function createCanadaDispositionEvent(params: {
  assetId: string;
  assetIdentityKey?: string | undefined;
  assetSymbol: string;
  eventId: string;
  proceedsReductionCad?: string | undefined;
  provenanceKind?: CanadaTaxInputEvent['provenanceKind'] | undefined;
  quantity: string;
  timestamp: Date | string;
  transactionId: number;
  unitValueCad: string;
}): CanadaDispositionEvent {
  const valuation = createBaseValuation(params.unitValueCad, params.quantity);

  return {
    ...buildEventBase({
      eventId: params.eventId,
      transactionId: params.transactionId,
      timestamp: params.timestamp,
      assetId: params.assetId,
      assetIdentityKey: params.assetIdentityKey,
      assetSymbol: params.assetSymbol,
      provenanceKind: params.provenanceKind,
      valuation,
    }),
    kind: 'disposition',
    quantity: parseDecimal(params.quantity),
    proceedsReductionCad:
      params.proceedsReductionCad !== undefined ? parseDecimal(params.proceedsReductionCad) : undefined,
  };
}

export function createCanadaTransferOutEvent(params: {
  assetId: string;
  assetIdentityKey?: string | undefined;
  assetSymbol: string;
  eventId: string;
  linkId?: number | undefined;
  provenanceKind?: CanadaTaxInputEvent['provenanceKind'] | undefined;
  quantity: string;
  sourceMovementFingerprint?: string | undefined;
  targetMovementFingerprint?: string | undefined;
  timestamp: Date | string;
  transactionId: number;
  unitValueCad: string;
}): CanadaTransferOutEvent {
  const valuation = createBaseValuation(params.unitValueCad, params.quantity);

  return {
    ...buildEventBase({
      eventId: params.eventId,
      transactionId: params.transactionId,
      timestamp: params.timestamp,
      assetId: params.assetId,
      assetIdentityKey: params.assetIdentityKey,
      assetSymbol: params.assetSymbol,
      provenanceKind: params.provenanceKind,
      linkId: params.linkId,
      sourceMovementFingerprint: params.sourceMovementFingerprint,
      targetMovementFingerprint: params.targetMovementFingerprint,
      valuation,
    }),
    kind: 'transfer-out',
    quantity: parseDecimal(params.quantity),
  };
}

export function createCanadaTransferInEvent(params: {
  assetId: string;
  assetIdentityKey?: string | undefined;
  assetSymbol: string;
  eventId: string;
  linkId?: number | undefined;
  provenanceKind?: CanadaTaxInputEvent['provenanceKind'] | undefined;
  quantity: string;
  sourceMovementFingerprint?: string | undefined;
  sourceTransactionId?: number | undefined;
  targetMovementFingerprint?: string | undefined;
  timestamp: Date | string;
  transactionId: number;
  unitValueCad: string;
}): CanadaTransferInEvent {
  const valuation = createBaseValuation(params.unitValueCad, params.quantity);

  return {
    ...buildEventBase({
      eventId: params.eventId,
      transactionId: params.transactionId,
      timestamp: params.timestamp,
      assetId: params.assetId,
      assetIdentityKey: params.assetIdentityKey,
      assetSymbol: params.assetSymbol,
      provenanceKind: params.provenanceKind,
      linkId: params.linkId,
      sourceMovementFingerprint: params.sourceMovementFingerprint,
      sourceTransactionId: params.sourceTransactionId,
      targetMovementFingerprint: params.targetMovementFingerprint,
      valuation,
    }),
    kind: 'transfer-in',
    quantity: parseDecimal(params.quantity),
  };
}

export function createCanadaFeeAdjustmentEvent(params: {
  adjustmentType: CanadaFeeAdjustmentEvent['adjustmentType'];
  assetId: string;
  assetIdentityKey?: string | undefined;
  assetSymbol: string;
  eventId: string;
  feeAssetId: string;
  feeAssetIdentityKey?: string | undefined;
  feeAssetSymbol: string;
  feeQuantity: string;
  provenanceKind?: CanadaTaxInputEvent['provenanceKind'] | undefined;
  quantityReduced?: string | undefined;
  relatedEventId?: string | undefined;
  timestamp: Date | string;
  totalValueCad: string;
  transactionId: number;
}): CanadaFeeAdjustmentEvent {
  const totalValueCad = parseDecimal(params.totalValueCad);

  return {
    ...buildEventBase({
      eventId: params.eventId,
      transactionId: params.transactionId,
      timestamp: params.timestamp,
      assetId: params.assetId,
      assetIdentityKey: params.assetIdentityKey,
      assetSymbol: params.assetSymbol,
      provenanceKind: params.provenanceKind,
      valuation: {
        taxCurrency: 'CAD',
        storagePriceAmount: totalValueCad,
        storagePriceCurrency: 'CAD' as Currency,
        quotedPriceAmount: totalValueCad,
        quotedPriceCurrency: 'CAD' as Currency,
        unitValueCad: totalValueCad,
        totalValueCad,
        valuationSource: 'stored-price',
      },
    }),
    kind: 'fee-adjustment',
    adjustmentType: params.adjustmentType,
    feeAssetId: params.feeAssetId,
    feeAssetIdentityKey: params.feeAssetIdentityKey,
    feeAssetSymbol: params.feeAssetSymbol as Currency,
    feeQuantity: parseDecimal(params.feeQuantity),
    quantityReduced: params.quantityReduced !== undefined ? parseDecimal(params.quantityReduced) : undefined,
    relatedEventId: params.relatedEventId,
  };
}

export function createCanadaInputContext(params: {
  feeOnlyInternalCarryoverSourceTransactionIds?: number[] | undefined;
  inputEvents: CanadaTaxInputEvent[];
  scopedTransactionIds?: number[] | undefined;
  validatedTransferLinkIds?: number[] | undefined;
}): CanadaTaxInputContext {
  return {
    taxCurrency: 'CAD',
    scopedTransactionIds: params.scopedTransactionIds ?? [
      ...new Set(params.inputEvents.map((event) => event.transactionId)),
    ],
    validatedTransferLinkIds: params.validatedTransferLinkIds ?? [],
    feeOnlyInternalCarryoverSourceTransactionIds: params.feeOnlyInternalCarryoverSourceTransactionIds ?? [],
    inputEvents: params.inputEvents,
  };
}
