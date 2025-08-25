import type { BlockchainTransaction, TransactionType, UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { SnowtraceRawDataSchema } from '../schemas.ts';
import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from '../types.ts';

export interface SnowtraceRawData {
  internal: SnowtraceInternalTransaction[];
  normal: SnowtraceTransaction[];
}

@RegisterProcessor('snowtrace')
export class SnowtraceProcessor implements IProviderProcessor<SnowtraceRawData> {
  private static convertInternalTransaction(
    tx: SnowtraceInternalTransaction,
    userAddress: string
  ): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    let type: 'internal_transfer_in' | 'internal_transfer_out' | 'transfer';
    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'internal_transfer_out';
    } else {
      type = 'internal_transfer_in';
    }

    const valueWei = new Decimal(tx.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));

    return {
      blockHash: '',
      blockNumber: parseInt(tx.blockNumber),
      fee: createMoney(0, 'AVAX'),
      from: tx.from,
      gasPrice: 0,
      gasUsed: parseInt(tx.gasUsed),
      hash: tx.hash,
      status: tx.isError === '0' ? 'success' : 'failed',
      timestamp: parseInt(tx.timeStamp) * 1000,
      to: tx.to,
      type,
      value: createMoney(valueAvax.toNumber(), 'AVAX'),
    };
  }

  private static convertNormalTransaction(tx: SnowtraceTransaction, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: 'transfer_in' | 'transfer_out' | 'transfer';
    if (isFromUser && isToUser) {
      type = 'transfer'; // Self-transfer
    } else if (isFromUser) {
      type = 'transfer_out';
    } else {
      type = 'transfer_in';
    }

    // Convert value from wei to AVAX
    const valueWei = new Decimal(tx.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));

    // Calculate fee
    const gasUsed = new Decimal(tx.gasUsed);
    const gasPrice = new Decimal(tx.gasPrice);
    const feeWei = gasUsed.mul(gasPrice);
    const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));

    return {
      blockHash: tx.blockHash,
      blockNumber: parseInt(tx.blockNumber),
      confirmations: parseInt(tx.confirmations),
      fee: createMoney(feeAvax.toNumber(), 'AVAX'),
      from: tx.from,
      gasPrice: parseDecimal(tx.gasPrice).toNumber(),
      gasUsed: parseInt(tx.gasUsed),
      hash: tx.hash,
      status: tx.txreceipt_status === '1' ? 'success' : 'failed',
      timestamp: parseInt(tx.timeStamp) * 1000,
      to: tx.to,
      type,
      value: createMoney(valueAvax.toNumber(), 'AVAX'),
    };
  }

  private static convertTokenTransfer(tx: SnowtraceTokenTransfer, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to.toLowerCase() === userAddress.toLowerCase();

    let type: 'token_transfer_in' | 'token_transfer_out' | 'transfer';
    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'token_transfer_out';
    } else {
      type = 'token_transfer_in';
    }

    // Convert value using token decimals
    const decimals = parseInt(tx.tokenDecimal);
    const valueRaw = new Decimal(tx.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));

    return {
      blockHash: tx.blockHash,
      blockNumber: parseInt(tx.blockNumber),
      confirmations: parseInt(tx.confirmations),
      fee: createMoney(0, 'AVAX'),
      from: tx.from,
      gasPrice: parseDecimal(tx.gasPrice).toNumber(),
      gasUsed: parseInt(tx.gasUsed),
      hash: tx.hash,
      status: 'success',
      timestamp: parseInt(tx.timeStamp) * 1000,
      to: tx.to,
      tokenContract: tx.contractAddress,
      tokenSymbol: tx.tokenSymbol,
      type,
      value: createMoney(value.toNumber(), tx.tokenSymbol),
    };
  }

  static processAddressTransactions(rawData: SnowtraceRawData, userAddress: string): BlockchainTransaction[] {
    const transactions: BlockchainTransaction[] = [];

    // Process normal transactions
    for (const tx of rawData.normal) {
      transactions.push(this.convertNormalTransaction(tx, userAddress));
    }

    // Process internal transactions
    for (const tx of rawData.internal) {
      transactions.push(this.convertInternalTransaction(tx, userAddress));
    }

    // Sort by timestamp (newest first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    return transactions;
  }

  static processTokenTransactions(rawData: SnowtraceTokenTransfer[], userAddress: string): BlockchainTransaction[] {
    return rawData.map(tx => this.convertTokenTransfer(tx, userAddress));
  }

  // IProviderProcessor interface implementation
  transform(rawData: SnowtraceRawData, walletAddresses: string[]): UniversalTransaction {
    // Process the first transaction from combined normal and internal data
    const userAddress = walletAddresses[0] || '';

    // Combine all transactions
    const allTransactions: BlockchainTransaction[] = [];

    // Process normal transactions
    for (const tx of rawData.normal) {
      allTransactions.push(SnowtraceProcessor.convertNormalTransaction(tx, userAddress));
    }

    // Process internal transactions
    for (const tx of rawData.internal) {
      allTransactions.push(SnowtraceProcessor.convertInternalTransaction(tx, userAddress));
    }

    if (allTransactions.length === 0) {
      throw new Error('No transactions to transform from SnowtraceRawData');
    }

    // Sort by timestamp (newest first) and take the first one
    allTransactions.sort((a, b) => b.timestamp - a.timestamp);
    const bcTx = allTransactions[0];

    // Convert to UniversalTransaction following Bitcoin pattern
    let type: UniversalTransaction['type'];
    const isFromUser = bcTx.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = bcTx.to.toLowerCase() === userAddress.toLowerCase();

    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'withdrawal';
    } else {
      type = 'deposit';
    }

    return {
      amount: bcTx.value,
      datetime: new Date(bcTx.timestamp).toISOString(),
      fee: bcTx.fee,
      from: bcTx.from,
      id: bcTx.hash,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: bcTx.blockNumber,
        providerId: 'snowtrace',
        rawData: bcTx,
      },
      source: 'avalanche',
      status: bcTx.status === 'success' ? 'ok' : 'failed',
      symbol: bcTx.tokenSymbol || 'AVAX',
      timestamp: bcTx.timestamp,
      to: bcTx.to,
      type,
    };
  }

  validate(rawData: SnowtraceRawData): ValidationResult {
    const result = SnowtraceRawDataSchema.safeParse(rawData);

    if (result.success) {
      return { isValid: true };
    }

    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });

    return {
      errors,
      isValid: false,
    };
  }
}
