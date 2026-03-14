import { parseDecimal } from '@exitbook/core';

import type { ExchangeCorrelationGroup } from './exchange-correlation-group.js';
import type { ExchangeFeeDraft, ExchangeMovementDraft } from './exchange-interpretation.js';
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
  const byAsset = new Map<string, ExchangeMovementDraft>();

  for (const movement of movements) {
    const existing = byAsset.get(movement.assetId);
    if (!existing) {
      byAsset.set(movement.assetId, { ...movement });
      continue;
    }

    const grossAmount = parseDecimal(existing.grossAmount).plus(parseDecimal(movement.grossAmount)).toFixed();
    const existingNet = existing.netAmount ?? existing.grossAmount;
    const movementNet = movement.netAmount ?? movement.grossAmount;
    const netAmount = parseDecimal(existingNet).plus(parseDecimal(movementNet)).toFixed();

    byAsset.set(movement.assetId, {
      ...existing,
      grossAmount,
      netAmount,
    });
  }

  return Array.from(byAsset.values());
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

    byFee.set(key, {
      ...existing,
      amount: parseDecimal(existing.amount).plus(parseDecimal(fee.amount)).toFixed(),
    });
  }

  return Array.from(byFee.values()).filter((fee) => !parseDecimal(fee.amount).isZero());
}
