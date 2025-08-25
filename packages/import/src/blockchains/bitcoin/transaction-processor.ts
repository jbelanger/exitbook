import type { TransactionType, UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import type { Logger } from '@crypto/shared-logger';
import { createMoney } from '@crypto/shared-utils';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import type { IProcessor, StoredRawData } from '../../shared/processors/interfaces.ts';
import type { BlockstreamTransaction, MempoolTransaction } from './types.ts';

/**
 * Bitcoin transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Handles wallet-aware parsing to determine
 * transaction direction and type based on user addresses.
 */
export class BitcoinTransactionProcessor implements IProcessor<MempoolTransaction | BlockstreamTransaction> {
  private logger: Logger;

  constructor(dependencies: IDependencyContainer) {
    this.logger = getLogger('BitcoinTransactionProcessor');
  }

  /**
   * Determine raw transaction type for metadata tracking.
   */
  private determineRawTransactionType(
    totalValueChange: number,
    isIncoming: boolean,
    isOutgoing: boolean
  ): 'transfer_in' | 'transfer_out' | 'internal_transfer_in' | 'internal_transfer_out' {
    if (isIncoming && !isOutgoing) {
      return 'transfer_in';
    } else if (isOutgoing && !isIncoming) {
      return 'transfer_out';
    } else if (isIncoming && isOutgoing) {
      // Internal transfer within our wallet - treat based on net change
      return totalValueChange >= 0 ? 'internal_transfer_in' : 'internal_transfer_out';
    } else {
      // Neither incoming nor outgoing (shouldn't happen with proper filtering)
      return 'transfer_out';
    }
  }

  /**
   * Parse a raw Bitcoin transaction with wallet context into UniversalTransaction format.
   */
  private parseWalletTransaction(
    tx: MempoolTransaction | BlockstreamTransaction,
    walletAddresses: string[]
  ): UniversalTransaction {
    const timestamp = tx.status.confirmed && tx.status.block_time ? tx.status.block_time * 1000 : Date.now();

    // Calculate transaction value considering all wallet addresses
    let totalValueChange = 0;
    let isIncoming = false;
    let isOutgoing = false;
    const relevantAddresses = new Set(walletAddresses);

    // Check inputs - money going out of our wallet
    for (const input of tx.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        isOutgoing = true;
        if (input.prevout?.value) {
          totalValueChange -= input.prevout.value;
        }
      }
    }

    // Check outputs - money coming into our wallet
    for (const output of tx.vout) {
      if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
        isIncoming = true;
        totalValueChange += output.value;
      }
    }

    // Determine transaction type
    let type: TransactionType = 'transfer';

    if (walletAddresses.length > 0) {
      if (isIncoming && !isOutgoing) {
        type = 'deposit';
      } else if (isOutgoing && !isIncoming) {
        type = 'withdrawal';
      } else if (isIncoming && isOutgoing) {
        // Internal transfer within our wallet
        type = 'transfer';
      }
    }

    const totalValue = Math.abs(totalValueChange);
    const fee = isOutgoing ? tx.fee : 0;

    // Determine from/to addresses (first relevant address found)
    let fromAddress = '';
    let toAddress = '';

    // For from address, look for wallet addresses in inputs
    for (const input of tx.vin) {
      if (input.prevout?.scriptpubkey_address && relevantAddresses.has(input.prevout.scriptpubkey_address)) {
        fromAddress = input.prevout.scriptpubkey_address;
        break;
      }
    }

    // For to address, look for wallet addresses in outputs
    for (const output of tx.vout) {
      if (output.scriptpubkey_address && relevantAddresses.has(output.scriptpubkey_address)) {
        toAddress = output.scriptpubkey_address;
        break;
      }
    }

    // Fallback to first addresses if no wallet addresses found
    if (!fromAddress && tx.vin.length > 0 && tx.vin[0]?.prevout?.scriptpubkey_address) {
      fromAddress = tx.vin[0].prevout.scriptpubkey_address;
    }

    if (!toAddress && tx.vout.length > 0 && tx.vout[0]?.scriptpubkey_address) {
      toAddress = tx.vout[0].scriptpubkey_address;
    }

    return {
      amount: createMoney(totalValue / 100000000, 'BTC'),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney(fee / 100000000, 'BTC'),
      from: fromAddress,
      id: tx.txid,
      metadata: {
        blockHash: tx.status.block_hash || '',
        blockNumber: tx.status.block_height || 0,
        confirmations: tx.status.confirmed ? 1 : 0,
        originalTransaction: tx,
        rawTransactionType: this.determineRawTransactionType(totalValueChange, isIncoming, isOutgoing),
      },
      network: 'mainnet',
      source: 'bitcoin',
      status: tx.status.confirmed ? 'closed' : 'open',
      symbol: 'BTC',
      timestamp: timestamp,
      to: toAddress,
      type: type,
    };
  }

  /**
   * Check if this processor can handle data from the specified adapter.
   */
  canProcess(adapterId: string, adapterType: string): boolean {
    return adapterId.toLowerCase() === 'bitcoin' && adapterType === 'blockchain';
  }

  /**
   * Process raw blockchain transaction data into UniversalTransaction format.
   */
  async process(
    rawDataItems: StoredRawData<MempoolTransaction | BlockstreamTransaction>[]
  ): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${rawDataItems.length} raw Bitcoin transactions`);

    const universalTransactions: UniversalTransaction[] = [];

    for (const item of rawDataItems) {
      try {
        const transaction = await this.processSingle(item);
        if (transaction) {
          universalTransactions.push(transaction);
        }
      } catch (error) {
        this.logger.error(`Failed to process transaction ${item.sourceTransactionId}: ${error}`);
      }
    }

    this.logger.info(`Successfully processed ${universalTransactions.length} Bitcoin transactions`);
    return universalTransactions;
  }

  /**
   * Process a single raw transaction data item.
   */
  async processSingle(
    rawDataItem: StoredRawData<MempoolTransaction | BlockstreamTransaction>
  ): Promise<UniversalTransaction | null> {
    try {
      const { metadata, rawData } = rawDataItem;

      // Extract user addresses from metadata if available
      const userAddresses: string[] = [];
      if (metadata && typeof metadata === 'object') {
        const meta = metadata as Record<string, unknown>;
        if (meta.addresses && Array.isArray(meta.addresses)) {
          userAddresses.push(...meta.addresses.filter((addr): addr is string => typeof addr === 'string'));
        }
        if (meta.address && typeof meta.address === 'string') {
          userAddresses.push(meta.address);
        }
      }

      const transaction = this.parseWalletTransaction(rawData, userAddresses);
      return transaction;
    } catch (error) {
      this.logger.error(`Failed to process single transaction ${rawDataItem.sourceTransactionId}: ${error}`);
      return null;
    }
  }
}
