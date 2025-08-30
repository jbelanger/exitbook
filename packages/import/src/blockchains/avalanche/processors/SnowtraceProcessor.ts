import type { BlockchainTransaction, UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { SnowtraceTransactionSchema } from '../schemas.ts';
import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from '../types.ts';

export type SnowtraceRawData = {
  internal: SnowtraceInternalTransaction[];
  normal: SnowtraceTransaction[];
};

@RegisterProcessor('snowtrace')
export class SnowtraceProcessor extends BaseProviderProcessor<SnowtraceTransaction> {
  protected readonly schema = SnowtraceTransactionSchema;
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
    const normalTransactions = rawData.normal?.map(tx => this.convertNormalTransaction(tx, userAddress)) || [];
    const internalTransactions = rawData.internal?.map(tx => this.convertInternalTransaction(tx, userAddress)) || [];

    return [...normalTransactions, ...internalTransactions];
  }

  static processTokenTransactions(tokens: SnowtraceTokenTransfer[], userAddress: string): BlockchainTransaction[] {
    return tokens.map(tx => this.convertTokenTransfer(tx, userAddress));
  }

  protected transformValidated(
    rawData: SnowtraceTransaction,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string> {
    const userAddress = walletAddresses[0] || '';
    const isFromUser = rawData.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = rawData.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: UniversalTransaction['type'];
    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'withdrawal';
    } else {
      type = 'deposit';
    }

    // Convert value from wei to AVAX
    const valueWei = new Decimal(rawData.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));

    // Calculate fee
    const gasUsed = new Decimal(rawData.gasUsed);
    const gasPrice = new Decimal(rawData.gasPrice);
    const feeWei = gasUsed.mul(gasPrice);
    const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));

    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return ok({
      amount: createMoney(valueAvax.toString(), 'AVAX'),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney(feeAvax.toString(), 'AVAX'),
      from: rawData.from,
      id: rawData.hash,
      metadata: {
        blockchain: 'avalanche',
        blockNumber: parseInt(rawData.blockNumber),
        providerId: 'snowtrace',
        rawData,
      },
      source: 'avalanche',
      status: rawData.txreceipt_status === '1' ? 'ok' : 'failed',
      symbol: 'AVAX',
      timestamp,
      to: rawData.to,
      type,
    });
  }
}
