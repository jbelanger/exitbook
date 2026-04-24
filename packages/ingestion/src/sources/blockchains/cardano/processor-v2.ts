import { type CardanoTransaction, CardanoTransactionSchema } from '@exitbook/blockchain-providers/cardano';
import { err, ok, type Result } from '@exitbook/foundation';

import { processLedgerProcessorItems } from '../shared/ledger-processor-v2-utils.js';

import {
  assembleCardanoLedgerDraft,
  type CardanoLedgerDraft,
  type CardanoProcessorV2Context,
} from './journal-assembler.js';

function buildCardanoTransactionComparisonMaterial(transaction: CardanoTransaction): string {
  return JSON.stringify({
    blockHeight: transaction.blockHeight,
    delegationCertificates: transaction.delegationCertificates ?? [],
    feeAmount: transaction.feeAmount,
    feeCurrency: transaction.feeCurrency,
    id: transaction.id,
    inputs: transaction.inputs,
    mirCertificates: transaction.mirCertificates ?? [],
    outputs: transaction.outputs,
    protocolDepositDeltaAmount: transaction.protocolDepositDeltaAmount,
    status: transaction.status,
    stakeCertificates: transaction.stakeCertificates ?? [],
    timestamp: transaction.timestamp,
    treasuryDonationAmount: transaction.treasuryDonationAmount,
    withdrawals: transaction.withdrawals ?? [],
  });
}

function assembleCardanoLedgerDraftWithContext(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<CardanoLedgerDraft, Error> {
  const draftResult = assembleCardanoLedgerDraft(transaction, context);
  if (draftResult.isErr()) {
    return err(new Error(`Cardano v2 assembly failed for ${transaction.id}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

export class CardanoProcessorV2 {
  async process(
    normalizedData: unknown[],
    context: CardanoProcessorV2Context
  ): Promise<Result<CardanoLedgerDraft[], Error>> {
    return processLedgerProcessorItems({
      assemble: (transaction) => assembleCardanoLedgerDraftWithContext(transaction, context),
      buildComparisonMaterial: buildCardanoTransactionComparisonMaterial,
      conflictLabel: 'Cardano v2',
      inputLabel: 'cardano v2',
      normalizedData,
      processorLabel: 'Cardano v2',
      schema: CardanoTransactionSchema,
    });
  }
}
