import type { BlockchainTransaction, UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney, maskAddress } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { SolscanRawTransactionData } from '../clients/SolscanApiClient.ts';
import { SolscanRawTransactionDataSchema } from '../schemas.ts';
import type { SolscanTransaction } from '../types.ts';
import { lamportsToSol } from '../utils.ts';

const logger = getLogger('SolscanProcessor');

@RegisterProcessor('solscan')
export class SolscanProcessor extends BaseProviderProcessor<SolscanRawTransactionData> {
  protected readonly schema = SolscanRawTransactionDataSchema;
  static processAddressTransactions(rawData: SolscanRawTransactionData, userAddress: string): BlockchainTransaction[] {
    logger.debug(
      `Processing Solscan address transactions - Address: ${maskAddress(userAddress)}, RawTransactionCount: ${rawData.normal.length}`
    );

    const transactions: BlockchainTransaction[] = [];

    for (const tx of rawData.normal) {
      const processedTx = this.transformTransaction(tx, userAddress);
      if (processedTx) {
        transactions.push(processedTx);
      }
    }

    // Sort by timestamp (newest first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    logger.debug(
      `Successfully processed Solscan address transactions - Address: ${maskAddress(userAddress)}, ProcessedTransactionCount: ${transactions.length}, FilteredOut: ${rawData.normal.length - transactions.length}`
    );

    return transactions;
  }

  private static transformTransaction(tx: SolscanTransaction, userAddress: string): BlockchainTransaction | null {
    try {
      // Check if user is involved in the transaction
      const isUserSigner = tx.signer.includes(userAddress);
      const userAccount = tx.inputAccount?.find(acc => acc.account === userAddress);

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
        blockHash: '',
        blockNumber: tx.slot,
        confirmations: 1,
        fee: createMoney(fee.toNumber(), 'SOL'),
        from: tx.signer?.[0] || '',
        gasPrice: undefined,
        gasUsed: undefined,
        hash: tx.txHash,
        nonce: undefined,
        status: tx.status === 'Success' ? 'success' : 'failed',
        timestamp: tx.blockTime * 1000,
        to: '',
        tokenContract: undefined,
        tokenSymbol: 'SOL',
        type,
        value: createMoney(amount.toNumber(), 'SOL'),
      };
    } catch (error) {
      logger.warn(
        `Failed to transform transaction - TxHash: ${tx.txHash}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  // IProviderProcessor interface implementation
  protected transformValidated(
    rawData: SolscanRawTransactionData,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    // Process the first transaction for interface compatibility
    const userAddress = walletAddresses[0] || '';

    if (!rawData.normal || rawData.normal.length === 0) {
      throw new Error('No transactions to transform from SolscanRawTransactionData');
    }

    const tx = rawData.normal[0];
    const processedTx = SolscanProcessor.transformTransaction(tx, userAddress);

    if (!processedTx) {
      throw new Error('Unable to transform Solscan transaction to UniversalTransaction');
    }

    // Convert BlockchainTransaction to UniversalTransaction
    let type: UniversalTransaction['type'];
    if (processedTx.type === 'transfer_in') {
      type = 'deposit';
    } else if (processedTx.type === 'transfer_out') {
      type = 'withdrawal';
    } else {
      type = 'transfer';
    }

    return ok({
      amount: processedTx.value,
      datetime: new Date(processedTx.timestamp).toISOString(),
      fee: processedTx.fee,
      from: processedTx.from,
      id: processedTx.hash,
      metadata: {
        blockchain: 'solana',
        blockNumber: processedTx.blockNumber,
        providerId: 'solscan',
        rawData: tx,
      },
      source: 'solana',
      status: processedTx.status === 'success' ? 'ok' : 'failed',
      symbol: processedTx.tokenSymbol || 'SOL',
      timestamp: processedTx.timestamp,
      to: processedTx.to,
      type,
    });
  }
}
