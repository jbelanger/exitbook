import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export interface SameHashPreparedParticipant {
  txId: number;
  accountId: number;
  assetId: string;
  inflowGrossAmount: Decimal;
  inflowMovementCount: number;
  outflowGrossAmount: Decimal;
  outflowMovementCount: number;
  onChainFeeAmount: Decimal;
  outflowMovementFingerprint: string | undefined;
  inflowMovementFingerprint: string | undefined;
}

export interface SameHashPreparedAssetGroup {
  normalizedHash: string;
  blockchain: string;
  assetId: string;
  assetSymbol: Currency;
  participants: SameHashPreparedParticipant[];
}

export interface InternalWithExternalAmount {
  type: 'internal_with_external';
  senderTxId: number;
  assetId: string;
  internalInflowTotal: Decimal;
  dedupedFee: Decimal;
  internalReceiverTxIds: number[];
}

export interface InternalFeeOnly {
  type: 'internal_fee_only';
  senderTxId: number;
  senderMovementFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  dedupedFee: Decimal;
  receivers: {
    movementFingerprint: string;
    quantity: Decimal;
    txId: number;
  }[];
}

export interface SameHashSourceAllocation {
  txId: number;
  movementFingerprint: string;
  externalAmount: Decimal;
  internalAmount: Decimal;
  feeDeducted: Decimal;
}

export type MultiSourceSameHashFeeAccounting =
  | {
      feeOwnerTxId: number;
      kind: 'deduped_shared_fee';
      otherParticipantTxIds: number[];
      totalFee: Decimal;
    }
  | {
      kind: 'per_source_allocated_fee';
      totalFee: Decimal;
    };

export interface MultiSourcePreparedExternalAmount {
  type: 'multi_source_prepared_external_amount';
  assetId: string;
  feeAccounting: MultiSourceSameHashFeeAccounting;
  internalReceiverTxIds: number[];
  sourceAllocations: SameHashSourceAllocation[];
}

export interface MultiSourceInternalFeeOnly {
  type: 'multi_source_internal_fee_only';
  assetId: string;
  assetSymbol: Currency;
  feeAccounting: MultiSourceSameHashFeeAccounting;
  sourceCarryovers: {
    retainedQuantity: Decimal;
    sourceMovementFingerprint: string;
    sourceTxId: number;
    targets: {
      movementFingerprint: string;
      quantity: Decimal;
      txId: number;
    }[];
  }[];
}

export type SameHashPreparedDecision =
  | InternalWithExternalAmount
  | InternalFeeOnly
  | MultiSourcePreparedExternalAmount
  | MultiSourceInternalFeeOnly;
