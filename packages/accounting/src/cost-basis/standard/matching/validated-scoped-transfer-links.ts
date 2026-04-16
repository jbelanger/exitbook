import type {
  TransferValidationTransactionView,
  ValidatedTransferLink,
  ValidatedTransferSet,
} from '../../../accounting-layer/validated-transfer-links.js';
import { validateTransferLinks } from '../../../accounting-layer/validated-transfer-links.js';

import type { AccountingScopedTransaction } from './scoped-transaction-types.js';

export type ValidatedScopedTransferLink = ValidatedTransferLink;
export type ValidatedScopedTransferSet = ValidatedTransferSet;

export function validateScopedTransferLinks(
  scopedTransactions: readonly AccountingScopedTransaction[],
  confirmedLinks: Parameters<typeof validateTransferLinks>[1]
): ReturnType<typeof validateTransferLinks> {
  return validateTransferLinks(scopedTransactions.map(buildTransferValidationTransactionView), confirmedLinks);
}

function buildTransferValidationTransactionView(
  scopedTransaction: AccountingScopedTransaction
): TransferValidationTransactionView {
  return {
    processedTransaction: scopedTransaction.tx,
    inflows: scopedTransaction.movements.inflows.map((movement) => ({
      assetId: movement.assetId,
      grossQuantity: movement.grossAmount,
      movementFingerprint: movement.movementFingerprint,
      netQuantity: movement.netAmount,
    })),
    outflows: scopedTransaction.movements.outflows.map((movement) => ({
      assetId: movement.assetId,
      grossQuantity: movement.grossAmount,
      movementFingerprint: movement.movementFingerprint,
      netQuantity: movement.netAmount,
    })),
  };
}
