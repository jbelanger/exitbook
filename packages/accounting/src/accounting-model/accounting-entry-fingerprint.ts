import { err, getErrorMessage, ok, sha256Hex, type Result } from '@exitbook/foundation';

import type { AccountingEntryDraft, AccountingProvenanceBinding } from './accounting-entry-types.js';

function sha256Result(material: string): Result<string, Error> {
  try {
    return ok(sha256Hex(material));
  } catch (error) {
    return err(new Error(`Failed to compute accounting entry fingerprint: ${getErrorMessage(error)}`));
  }
}

function validateBinding(binding: AccountingProvenanceBinding): Result<void, Error> {
  if (binding.txFingerprint.trim() === '') {
    return err(new Error('Accounting provenance binding txFingerprint must not be empty'));
  }

  if (binding.movementFingerprint.trim() === '') {
    return err(new Error('Accounting provenance binding movementFingerprint must not be empty'));
  }

  if (!binding.quantity.gt(0)) {
    return err(new Error('Accounting provenance binding quantity must be positive'));
  }

  return ok(undefined);
}

function compareBindingIdentity(left: AccountingProvenanceBinding, right: AccountingProvenanceBinding): number {
  const movementComparison = left.movementFingerprint.localeCompare(right.movementFingerprint);
  if (movementComparison !== 0) {
    return movementComparison;
  }

  const transactionComparison = left.txFingerprint.localeCompare(right.txFingerprint);
  if (transactionComparison !== 0) {
    return transactionComparison;
  }

  return left.quantity.toFixed().localeCompare(right.quantity.toFixed());
}

function buildBindingMaterial(binding: AccountingProvenanceBinding): string {
  return `${binding.txFingerprint}|${binding.movementFingerprint}|${binding.quantity.toFixed()}`;
}

export function buildAccountingEntryFingerprintMaterial(entry: AccountingEntryDraft): Result<string, Error> {
  if (entry.assetId.trim() === '') {
    return err(new Error('Accounting entry assetId must not be empty'));
  }

  if (!entry.quantity.gt(0)) {
    return err(new Error('Accounting entry quantity must be positive'));
  }

  if (entry.provenanceBindings.length === 0) {
    return err(new Error('Accounting entry must have at least one provenance binding'));
  }

  const normalizedBindings: AccountingProvenanceBinding[] = [];
  for (const binding of entry.provenanceBindings) {
    const validationResult = validateBinding(binding);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    normalizedBindings.push(binding);
  }

  const sortedBindings = [...normalizedBindings].sort(compareBindingIdentity);
  const bindingMaterial = sortedBindings.map(buildBindingMaterial).join('|');

  if (entry.kind === 'fee') {
    return ok(
      `${entry.kind}|${entry.assetId}|${entry.quantity.toFixed()}|${entry.feeScope}|${entry.feeSettlement}|${bindingMaterial}`
    );
  }

  return ok(`${entry.kind}|${entry.assetId}|${entry.quantity.toFixed()}|${entry.role}|${bindingMaterial}`);
}

export function computeAccountingEntryFingerprint(entry: AccountingEntryDraft): Result<string, Error> {
  const materialResult = buildAccountingEntryFingerprintMaterial(entry);
  if (materialResult.isErr()) {
    return err(materialResult.error);
  }

  return sha256Result(materialResult.value);
}
