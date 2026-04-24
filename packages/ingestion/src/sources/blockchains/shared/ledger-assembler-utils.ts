import { err, ok, tryParseDecimal, type Result } from '@exitbook/foundation';
import type { AccountingSourceComponentKind, SourceComponentQuantityRef } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

export interface LedgerProcessorAccountContext {
  fingerprint: string;
  id: number;
}

export function validateLedgerProcessorAccountContext(
  context: LedgerProcessorAccountContext,
  processorLabel: string
): Result<void, Error> {
  if (!Number.isInteger(context.id) || context.id <= 0) {
    return err(new Error(`${processorLabel} account id must be a positive integer, got ${context.id}`));
  }

  if (context.fingerprint.trim() === '') {
    return err(new Error(`${processorLabel} account fingerprint must not be empty`));
  }

  return ok(undefined);
}

export function parseLedgerDecimalAmount(params: {
  allowMissing?: boolean | undefined;
  label: string;
  processorLabel: string;
  transactionId: string;
  value: string | undefined;
}): Result<Decimal, Error> {
  if (params.value === undefined && params.allowMissing !== true) {
    return err(
      new Error(`${params.processorLabel} transaction ${params.transactionId} ${params.label} amount is missing`)
    );
  }

  const parsed = { value: new Decimal(0) };
  if (!tryParseDecimal(params.value ?? '0', parsed)) {
    return err(
      new Error(
        `${params.processorLabel} transaction ${params.transactionId} ${params.label} amount must be a valid decimal`
      )
    );
  }

  return ok(parsed.value);
}

export function buildSourceComponentQuantityRef(params: {
  assetId: string;
  componentId: string;
  componentKind: AccountingSourceComponentKind;
  occurrence?: number | undefined;
  quantity: Decimal;
  sourceActivityFingerprint: string;
}): SourceComponentQuantityRef {
  return {
    component: {
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      componentKind: params.componentKind,
      componentId: params.componentId,
      ...(params.occurrence === undefined ? {} : { occurrence: params.occurrence }),
      assetId: params.assetId,
    },
    quantity: params.quantity.abs(),
  };
}
