import {
  type BitcoinTransaction,
  type BitcoinTransactionInput,
  type BitcoinTransactionOutput,
} from '@exitbook/blockchain-providers/bitcoin';
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
export const ACCOUNT_FINGERPRINT = buildBitcoinAccountFingerprint(ACCOUNT_ID);
export const USER_ADDRESS = 'bc1quser1111111111111111111111111111111';
export const SIBLING_USER_ADDRESS = 'bc1qsibling111111111111111111111111111';
export const THIRD_USER_ADDRESS = 'bc1qthird11111111111111111111111111111';
export const EXTERNAL_ADDRESS = 'bc1qexternal111111111111111111111111111';
export const ANOTHER_EXTERNAL_ADDRESS = 'bc1qanother222222222222222222222222222';

export function buildBitcoinAccountFingerprint(accountId: number): string {
  return sha256Hex(`default|wallet|bitcoin|identifier-${accountId}`);
}

export function createInput(
  address: string,
  value: string,
  overrides: Partial<BitcoinTransactionInput> = {}
): BitcoinTransactionInput {
  return {
    address,
    txid: 'prev-tx',
    value,
    vout: 0,
    ...overrides,
  };
}

export function createOutput(
  address: string | undefined,
  value: string,
  overrides: Partial<BitcoinTransactionOutput> = {}
): BitcoinTransactionOutput {
  const output: BitcoinTransactionOutput = {
    index: 0,
    value,
    ...overrides,
  };

  if (address !== undefined) {
    output.address = address;
  }

  return output;
}

export function createTransaction(overrides: Partial<BitcoinTransaction> = {}): BitcoinTransaction {
  return {
    blockHeight: 800000,
    currency: 'BTC',
    eventId: '0xevent',
    feeAmount: '0.0001',
    feeCurrency: 'BTC',
    id: 'tx-default',
    inputs: [createInput(EXTERNAL_ADDRESS, '200010000')],
    outputs: [createOutput(USER_ADDRESS, '200000000')],
    providerName: 'mempool.space',
    status: 'success',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
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
