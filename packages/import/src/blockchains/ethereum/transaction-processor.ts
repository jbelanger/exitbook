import type { BlockchainTransaction, TransactionType, UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';

const logger = getLogger('EthereumTransactionProcessor');

export class EthereumTransactionProcessor {
  static async processTransactions(
    rawTxs: BlockchainTransaction[],
    userAddresses: string[]
  ): Promise<UniversalTransaction[]> {
    logger.debug(`Processing ${rawTxs.length} Ethereum transactions for ${userAddresses.length} addresses`);

    const universalTxs = rawTxs.map(tx => this.transformToUniversal(tx, userAddresses));

    logger.debug(`Transformed ${universalTxs.length} Ethereum transactions to universal format`);
    return universalTxs;
  }

  private static transformToUniversal(tx: BlockchainTransaction, userAddresses: string[]): UniversalTransaction {
    // Determine transaction type based on user addresses
    let type: TransactionType = 'transfer';

    if (userAddresses.length > 0) {
      const userAddress = userAddresses[0].toLowerCase();
      const isIncoming = tx.to?.toLowerCase() === userAddress;
      const isOutgoing = tx.from?.toLowerCase() === userAddress;

      if (isIncoming && !isOutgoing) {
        type = 'deposit';
      } else if (isOutgoing && !isIncoming) {
        type = 'withdrawal';
      }
    }

    return {
      amount: tx.value,
      datetime: new Date(tx.timestamp).toISOString(),
      fee: tx.fee,
      from: tx.from,
      id: tx.hash,
      metadata: {
        blockHash: tx.blockHash,
        blockNumber: tx.blockNumber,
        confirmations: tx.confirmations,
        originalTransaction: tx,
        tokenContract: tx.tokenContract,
        transactionType: tx.type,
      },
      network: 'mainnet',
      source: 'ethereum',
      status: tx.status === 'success' ? 'closed' : tx.status === 'pending' ? 'open' : 'canceled',
      symbol: tx.tokenSymbol || tx.value.currency,
      timestamp: tx.timestamp,
      to: tx.to || '',
      type,
    };
  }
}
