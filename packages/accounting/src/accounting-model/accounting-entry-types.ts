import type { FeeMovement, MovementRole } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export type AccountingEntryKind = 'asset_inflow' | 'asset_outflow' | 'fee';

export interface AccountingProvenanceBinding {
  txFingerprint: string;
  movementFingerprint: string;
  quantity: Decimal;
}

interface AccountingEntryBase {
  entryFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  provenanceBindings: readonly AccountingProvenanceBinding[];
}

export interface AssetAccountingEntry extends AccountingEntryBase {
  kind: 'asset_inflow' | 'asset_outflow';
  role: MovementRole;
}

export interface FeeAccountingEntry extends AccountingEntryBase {
  kind: 'fee';
  feeScope: FeeMovement['scope'];
  feeSettlement: FeeMovement['settlement'];
}

export type AccountingEntry = AssetAccountingEntry | FeeAccountingEntry;

export type AssetAccountingEntryDraft = Omit<AssetAccountingEntry, 'entryFingerprint'>;
export type FeeAccountingEntryDraft = Omit<FeeAccountingEntry, 'entryFingerprint'>;
export type AccountingEntryDraft = AssetAccountingEntryDraft | FeeAccountingEntryDraft;
