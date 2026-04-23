import { err, type Result } from '@exitbook/foundation';

import { canonicalStringify } from '../internal/canonical-json.js';
import { computeFingerprint } from '../internal/fingerprint-utils.js';
import { computeSourceComponentFingerprint } from '../source-components/source-component-fingerprint.js';

import { AccountingPostingDraftSchema, type AccountingPostingDraft } from './posting-draft.js';

const ACCOUNTING_POSTING_FINGERPRINT_PREFIX = 'ledger_posting:v1';

export function buildAccountingPostingFingerprintMaterial(
  journalFingerprint: string,
  posting: AccountingPostingDraft
): Result<string, Error> {
  if (journalFingerprint.trim() === '') {
    return err(new Error('Journal fingerprint must not be empty'));
  }

  const validation = AccountingPostingDraftSchema.safeParse(posting);
  if (!validation.success) {
    return err(new Error(`Invalid accounting posting draft: ${validation.error.message}`));
  }

  const normalizedSourceComponents = [];
  for (const sourceComponentRef of posting.sourceComponentRefs) {
    const fingerprintResult = computeSourceComponentFingerprint(sourceComponentRef.component);
    if (fingerprintResult.isErr()) {
      return err(fingerprintResult.error);
    }

    normalizedSourceComponents.push({
      quantity: sourceComponentRef.quantity.toFixed(),
      sourceComponentFingerprint: fingerprintResult.value,
    });
  }

  normalizedSourceComponents.sort((left, right) => {
    const fingerprintComparison = left.sourceComponentFingerprint.localeCompare(right.sourceComponentFingerprint);
    if (fingerprintComparison !== 0) {
      return fingerprintComparison;
    }

    return left.quantity.localeCompare(right.quantity);
  });

  return canonicalStringify({
    assetId: posting.assetId,
    journalFingerprint,
    postingStableKey: posting.postingStableKey,
    quantity: posting.quantity.toFixed(),
    sourceComponentRefs: normalizedSourceComponents,
  });
}

export function computeAccountingPostingFingerprint(
  journalFingerprint: string,
  posting: AccountingPostingDraft
): Result<string, Error> {
  const materialResult = buildAccountingPostingFingerprintMaterial(journalFingerprint, posting);
  if (materialResult.isErr()) {
    return err(materialResult.error);
  }

  return computeFingerprint(ACCOUNTING_POSTING_FINGERPRINT_PREFIX, materialResult.value);
}
