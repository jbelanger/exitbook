import { parseDecimal } from '@exitbook/foundation';

import type { ExchangeCorrelationGroup } from './exchange-correlation-group.js';
import type {
  ExchangeFeeDraft,
  ExchangeMovementDraft,
  ExchangeMovementSourceComponentQuantityDraft,
} from './exchange-interpretation.js';
import type { ExchangeProcessingDiagnostic } from './exchange-processing-diagnostic.js';

export function diagnostic(
  group: ExchangeCorrelationGroup,
  code: ExchangeProcessingDiagnostic['code'],
  severity: ExchangeProcessingDiagnostic['severity'],
  message: string,
  evidence: Record<string, unknown>
): ExchangeProcessingDiagnostic {
  return {
    code,
    severity,
    providerName: group.providerName,
    correlationKey: group.correlationKey,
    providerEventIds: group.events.map((event) => event.providerEventId),
    message,
    evidence,
  };
}

export function consolidateMovements(movements: ExchangeMovementDraft[]): ExchangeMovementDraft[] {
  const byAssetAndRole = new Map<string, ExchangeMovementDraft>();

  for (const movement of movements) {
    const key = `${movement.assetId}:${movement.movementRole ?? 'principal'}`;
    const existing = byAssetAndRole.get(key);
    if (!existing) {
      byAssetAndRole.set(key, { ...movement });
      continue;
    }

    const grossAmount = parseDecimal(existing.grossAmount).plus(parseDecimal(movement.grossAmount)).toFixed();
    const existingNet = existing.netAmount ?? existing.grossAmount;
    const movementNet = movement.netAmount ?? movement.grossAmount;
    const netAmount = parseDecimal(existingNet).plus(parseDecimal(movementNet)).toFixed();
    const sourceEventIds = [...new Set([...(existing.sourceEventIds ?? []), ...(movement.sourceEventIds ?? [])])];
    const sourceComponentQuantities = consolidateMovementSourceComponentQuantities([
      ...(existing.sourceComponentQuantities ?? []),
      ...(movement.sourceComponentQuantities ?? []),
    ]);

    byAssetAndRole.set(key, {
      ...existing,
      grossAmount,
      netAmount,
      ...(sourceComponentQuantities.length > 0 ? { sourceComponentQuantities } : {}),
      ...(sourceEventIds.length > 0 ? { sourceEventIds } : {}),
    });
  }

  return Array.from(byAssetAndRole.values());
}

function consolidateMovementSourceComponentQuantities(
  sourceComponentQuantities: readonly ExchangeMovementSourceComponentQuantityDraft[]
): ExchangeMovementSourceComponentQuantityDraft[] {
  const bySourceEventId = new Map<string, ExchangeMovementSourceComponentQuantityDraft>();

  for (const sourceComponentQuantity of sourceComponentQuantities) {
    const existing = bySourceEventId.get(sourceComponentQuantity.sourceEventId);
    if (!existing) {
      bySourceEventId.set(sourceComponentQuantity.sourceEventId, { ...sourceComponentQuantity });
      continue;
    }

    bySourceEventId.set(sourceComponentQuantity.sourceEventId, {
      ...existing,
      quantity: parseDecimal(existing.quantity).plus(parseDecimal(sourceComponentQuantity.quantity)).toFixed(),
    });
  }

  return Array.from(bySourceEventId.values());
}

export function consolidateFees(fees: ExchangeFeeDraft[]): ExchangeFeeDraft[] {
  const byFee = new Map<string, ExchangeFeeDraft>();

  for (const fee of fees) {
    const key = `${fee.assetId}:${fee.scope}:${fee.settlement}`;
    const existing = byFee.get(key);
    if (!existing) {
      byFee.set(key, { ...fee });
      continue;
    }

    const sourceEventIds = [...new Set([...(existing.sourceEventIds ?? []), ...(fee.sourceEventIds ?? [])])];

    byFee.set(key, {
      ...existing,
      amount: parseDecimal(existing.amount).plus(parseDecimal(fee.amount)).toFixed(),
      ...(sourceEventIds.length > 0 ? { sourceEventIds } : {}),
    });
  }

  return Array.from(byFee.values()).filter((fee) => !parseDecimal(fee.amount).isZero());
}
