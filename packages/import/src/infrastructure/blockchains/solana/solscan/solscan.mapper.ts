import { getLogger } from '@crypto/shared-logger';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';
import { lamportsToSol } from '../utils.ts';

import type { SolscanRawTransactionData } from './solscan.api-client.ts';
import { SolscanRawTransactionDataSchema } from './solscan.schemas.ts';
import type { SolscanTransaction } from './solscan.types.ts';

const logger = getLogger('SolscanProcessor');

@RegisterTransactionMapper('solscan')
export class SolscanTransactionMapper extends BaseRawDataMapper<
  SolscanRawTransactionData,
  UniversalBlockchainTransaction
> {
  protected readonly schema = SolscanRawTransactionDataSchema;

  protected mapInternal(
    rawData: SolscanRawTransactionData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    if (!sessionContext.address) {
      return err('No address found in session context');
    }

    if (!rawData.normal || rawData.normal.length === 0) {
      return err('No transactions to transform from SolscanRawTransactionData');
    }

    const transactions: UniversalBlockchainTransaction[] = [];

    // Process ALL transactions in the batch, not just the first one
    for (const tx of rawData.normal) {
      const processedTx = this.transformTransaction(tx, sessionContext.address);

      if (!processedTx) {
        // Transaction filtered out - continue with next
        continue;
      }

      transactions.push(processedTx);
    }

    // todo: handle multiple transactions properly
    // For now, just return the first processed transaction for compatibility
    // with existing interfaces
    // if (transactions.length === 0) {
    //   return err('No relevant transactions found for the provided address');
    // }
    return err('Needs to implement custom solana raw data object');
  }

  private transformTransaction(
    tx: SolscanTransaction,
    userAddress: string
  ): UniversalBlockchainTransaction | undefined {
    try {
      // Check if user is involved in the transaction
      const isUserSigner = tx.signer.includes(userAddress);
      const userAccount = tx.inputAccount?.find((acc) => acc.account === userAddress);

      if (!isUserSigner && !userAccount) {
        logger.debug(`Transaction not relevant to user address - TxHash: ${tx.txHash}`);
        return undefined;
      }

      // Calculate amount and determine direction
      let amount = new Decimal(0);
      let type: 'transfer_in' | 'transfer_out' = 'transfer_out';

      if (userAccount) {
        const balanceChange = userAccount.postBalance - userAccount.preBalance;
        amount = lamportsToSol(Math.abs(balanceChange));
        type = balanceChange > 0 ? 'transfer_in' : 'transfer_out';
      } else {
        // Fallback to lamport field if available
        amount = lamportsToSol(Math.abs(tx.lamport || 0));
        type = 'transfer_out';
      }

      // Calculate fee
      const fee = lamportsToSol(tx.fee);

      return {
        amount: amount.toString(),
        blockHeight: tx.slot,
        currency: 'SOL',
        feeAmount: fee.toString(),
        feeCurrency: 'SOL',
        from: tx.signer?.[0] || '',
        id: tx.txHash,
        providerId: 'solscan',
        status: tx.status === 'Success' ? 'success' : 'failed',
        timestamp: tx.blockTime * 1000,
        to: '',
        type: type === 'transfer_out' ? 'transfer_out' : 'transfer_in',
      };
    } catch (error) {
      logger.warn(
        `Failed to transform transaction - TxHash: ${tx.txHash}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }
}
