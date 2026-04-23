import {
  type CardanoTransaction,
  type CardanoTransactionInput,
  type CardanoTransactionOutput,
} from '@exitbook/blockchain-providers/cardano';
import {
  buildAssetMovementCanonicalMaterial,
  buildFeeMovementCanonicalMaterial,
  type AssetMovement,
  type AssetMovementDraft,
  type FeeMovement,
  type FeeMovementDraft,
  type Transaction,
  type TransactionDraft,
} from '@exitbook/core';
import { seedAssetMovementFingerprint, seedFeeMovementFingerprint, seedTxFingerprint } from '@exitbook/core/test-utils';
import { sha256Hex } from '@exitbook/foundation';

export const ACCOUNT_ID = 1;
export const ACCOUNT_FINGERPRINT = buildCardanoAccountFingerprint(ACCOUNT_ID);
export const USER_ADDRESS = 'addr1quser1111111111111111111111111111111111111111111111111111';
export const SIBLING_USER_ADDRESS = 'addr1qsibling11111111111111111111111111111111111111111111111111';
export const THIRD_USER_ADDRESS = 'addr1qthird111111111111111111111111111111111111111111111111111';
export const EXTERNAL_ADDRESS = 'addr1qexternal11111111111111111111111111111111111111111111111';

export function buildCardanoAccountFingerprint(accountId: number): string {
  return sha256Hex(`default|wallet|cardano|identifier-${accountId}`);
}

export function createInput(
  address: string,
  amounts: { quantity: string; unit: string }[] | string,
  unit = 'lovelace',
  overrides: Partial<CardanoTransactionInput> = {}
): CardanoTransactionInput {
  return {
    address,
    amounts: typeof amounts === 'string' ? [{ quantity: amounts, unit }] : amounts,
    outputIndex: 0,
    txHash: 'prev-tx',
    ...overrides,
  };
}

export function createOutput(
  address: string,
  amounts: { quantity: string; unit: string }[] | string,
  unit = 'lovelace',
  overrides: Partial<CardanoTransactionOutput> = {}
): CardanoTransactionOutput {
  return {
    address,
    amounts: typeof amounts === 'string' ? [{ quantity: amounts, unit }] : amounts,
    outputIndex: 0,
    ...overrides,
  };
}

export function createTransaction(overrides: Partial<CardanoTransaction> = {}): CardanoTransaction {
  return {
    blockHeight: 9000000,
    currency: 'ADA',
    eventId: '0xevent',
    feeAmount: '0.17',
    feeCurrency: 'ADA',
    id: 'tx-default',
    inputs: [createInput(EXTERNAL_ADDRESS, '2170000')],
    outputs: [createOutput(USER_ADDRESS, '2000000')],
    providerName: 'blockfrost',
    status: 'success',
    timestamp: Date.now(),
    ...overrides,
  } as CardanoTransaction;
}

export function materializeProcessedTransactions(drafts: readonly TransactionDraft[], accountId = 1): Transaction[] {
  return drafts.map((draft, index) => materializeProcessedTransaction(draft, index + 1, accountId));
}

export function materializeProcessedTransaction(draft: TransactionDraft, id: number, accountId = 1): Transaction {
  const identityReference = resolveIdentityReference(draft);
  const { identityMaterial: _identityMaterial, ...transactionFields } = draft;
  const txFingerprint = seedTxFingerprint(
    transactionFields.platformKey,
    transactionFields.platformKind,
    accountId,
    identityReference
  );

  return {
    ...transactionFields,
    id,
    accountId,
    txFingerprint,
    movements: {
      inflows: materializeAssetMovements(txFingerprint, 'inflow', transactionFields.movements.inflows ?? []),
      outflows: materializeAssetMovements(txFingerprint, 'outflow', transactionFields.movements.outflows ?? []),
    },
    fees: materializeFeeMovements(txFingerprint, transactionFields.fees),
  };
}

function resolveIdentityReference(transaction: TransactionDraft): string {
  if (transaction.platformKind === 'blockchain') {
    const transactionHash = transaction.blockchain?.transaction_hash?.trim();
    if (!transactionHash) {
      throw new Error('Blockchain test transaction is missing blockchain.transaction_hash');
    }

    return transactionHash;
  }

  const componentEventIds = transaction.identityMaterial?.componentEventIds;
  if (!componentEventIds?.length) {
    throw new Error('Exchange test transaction is missing identityMaterial.componentEventIds');
  }

  return componentEventIds[0]!;
}

function materializeAssetMovements(
  txFingerprint: string,
  movementType: 'inflow' | 'outflow',
  movements: readonly AssetMovementDraft[]
): AssetMovement[] {
  const duplicateCounts = new Map<string, number>();

  return movements.map((movement) => {
    const canonicalMaterial = buildAssetMovementCanonicalMaterial({
      movementType,
      assetId: movement.assetId,
      grossAmount: movement.grossAmount,
      netAmount: movement.netAmount,
    });
    const duplicateOccurrence = (duplicateCounts.get(canonicalMaterial) ?? 0) + 1;
    duplicateCounts.set(canonicalMaterial, duplicateOccurrence);

    return {
      ...movement,
      movementFingerprint: seedAssetMovementFingerprint(txFingerprint, movementType, movement, duplicateOccurrence),
    };
  });
}

function materializeFeeMovements(txFingerprint: string, fees: readonly FeeMovementDraft[]): FeeMovement[] {
  const duplicateCounts = new Map<string, number>();

  return fees.map((fee) => {
    const canonicalMaterial = buildFeeMovementCanonicalMaterial({
      assetId: fee.assetId,
      amount: fee.amount,
      scope: fee.scope,
      settlement: fee.settlement,
    });
    const duplicateOccurrence = (duplicateCounts.get(canonicalMaterial) ?? 0) + 1;
    duplicateCounts.set(canonicalMaterial, duplicateOccurrence);

    return {
      ...fee,
      movementFingerprint: seedFeeMovementFingerprint(txFingerprint, fee, duplicateOccurrence),
    };
  });
}
