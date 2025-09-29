import { getLogger } from '@crypto/shared-logger';
import { hasStringProperty, isErrorWithMessage, maskAddress } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';
import { lamportsToSol } from '../utils.ts';

import { SolanaRPCRawTransactionDataSchema } from './solana-rpc.schemas.ts';
import type { SolanaRPCRawTransactionData, SolanaRPCTransaction } from './solana-rpc.types.ts';

const logger = getLogger('SolanaRPCProcessor');

@RegisterTransactionMapper('solana-rpc')
export class SolanaRPCTransactionMapper extends BaseRawDataMapper<
  SolanaRPCRawTransactionData,
  UniversalBlockchainTransaction
> {
  protected readonly schema = SolanaRPCRawTransactionDataSchema;
  protected mapInternal(
    rawData: SolanaRPCRawTransactionData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    if (!sessionContext.address) {
      return err('No address found in session context');
    }

    if (!rawData.normal || rawData.normal.length === 0) {
      throw new Error('No transactions to transform from SolanaRPCRawTransactionData');
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
    tx: SolanaRPCTransaction,
    userAddress: string
  ): UniversalBlockchainTransaction | undefined {
    try {
      // Skip failed transactions - they shouldn't be processed
      if (tx.meta.err) {
        logger.debug(
          `Skipping failed transaction - Hash: ${tx.transaction.signatures?.[0]}, Error: ${JSON.stringify(tx.meta.err)}`
        );
        return undefined;
      }

      const accountKeys = tx.transaction.message.accountKeys;
      const userIndex = accountKeys.findIndex((key) => key === userAddress);

      if (userIndex === -1) {
        logger.debug(`Transaction not relevant to user - Signature: ${tx.transaction.signatures?.[0]}`);
        return undefined;
      }

      // Calculate balance change
      const preBalance = tx.meta.preBalances[userIndex] || 0;
      const postBalance = tx.meta.postBalances[userIndex] || 0;
      const rawBalanceChange = postBalance - preBalance;

      // For fee payer, add back the fee to get the actual transfer amount
      const isFeePayerIndex = userIndex === 0;
      const feeAdjustment = isFeePayerIndex ? tx.meta.fee : 0;
      const balanceChange = rawBalanceChange + feeAdjustment;

      const amount = lamportsToSol(Math.abs(balanceChange));
      const type: 'transfer_in' | 'transfer_out' = balanceChange > 0 ? 'transfer_in' : 'transfer_out';
      const fee = lamportsToSol(tx.meta.fee);

      // Don't skip fee-only transactions - the base class will properly classify them as 'fee' type

      return {
        amount: amount.toString(),
        blockHeight: tx.slot,
        currency: 'SOL',
        feeAmount: fee.toString(),
        feeCurrency: 'SOL',
        from: accountKeys?.[0] || '',
        id: tx.transaction.signatures?.[0] || '',
        providerId: 'solana-rpc',
        status: tx.meta.err ? 'failed' : 'success',
        timestamp: (tx.blockTime || 0) * 1000,
        to: '',
        type,
      };
    } catch (error) {
      logger.warn(
        `Failed to transform transaction - Signature: ${tx.transaction.signatures?.[0]}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }
}
