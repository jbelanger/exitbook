import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { maskAddress } from '../../../address-utils.js';
import { getLogger } from '../../../pino-logger.js';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.js';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { UniversalBlockchainTransaction } from '../../shared/types.js';
import type { SolscanRawTransactionData } from '../clients/SolscanApiClient.js';
import { SolscanRawTransactionDataSchema } from '../schemas.js';
import type { SolscanTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

const logger = getLogger('SolscanProcessor');

@RegisterTransactionMapper('solscan')
export class SolscanTransactionMapper extends BaseRawDataMapper<SolscanRawTransactionData> {
  static processAddressTransactions(
    rawData: SolscanRawTransactionData,
    userAddress: string,
  ): UniversalBlockchainTransaction[] {
    logger.debug(
      `Processing Solscan address transactions - Address: ${maskAddress(userAddress)}, RawTransactionCount: ${rawData.normal.length}`,
    );

    const transactions: UniversalBlockchainTransaction[] = [];

    for (const tx of rawData.normal) {
      const processedTx = this.transformTransaction(tx, userAddress);
      if (processedTx) {
        transactions.push(processedTx);
      }
    }

    // Sort by timestamp (newest first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    logger.debug(
      `Successfully processed Solscan address transactions - Address: ${maskAddress(userAddress)}, ProcessedTransactionCount: ${transactions.length}, FilteredOut: ${rawData.normal.length - transactions.length}`,
    );

    return transactions;
  }

  private static transformTransaction(
    tx: SolscanTransaction,
    userAddress: string,
  ): UniversalBlockchainTransaction | null {
    try {
      // Check if user is involved in the transaction
      const isUserSigner = tx.signer.includes(userAddress);
      const userAccount = tx.inputAccount?.find((acc) => acc.account === userAddress);

      if (!isUserSigner && !userAccount) {
        logger.debug(`Transaction not relevant to user address - TxHash: ${tx.txHash}`);
        return null;
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
        `Failed to transform transaction - TxHash: ${tx.txHash}, Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
  protected readonly schema = SolscanRawTransactionDataSchema;
  protected mapInternal(
    rawData: SolscanRawTransactionData,
    sessionContext: ImportSessionMetadata,
  ): Result<UniversalBlockchainTransaction[], string> {
    if (!sessionContext.address) {
      return err('No address found in session context');
    }

    if (!rawData.normal || rawData.normal.length === 0) {
      return err('No transactions to transform from SolscanRawTransactionData');
    }

    const transactions: UniversalBlockchainTransaction[] = [];

    // Process ALL transactions in the batch, not just the first one
    for (const tx of rawData.normal) {
      const processedTx = SolscanTransactionMapper.transformTransaction(tx, sessionContext.address);

      if (!processedTx) {
        // Transaction filtered out - continue with next
        continue;
      }

      transactions.push(processedTx);
    }

    return ok(transactions);
  }
}
