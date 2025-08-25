import type { Balance, BlockchainTransaction, UniversalTransaction } from '@crypto/core';
import { createMoney, maskAddress } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { SubscanTransfer, SubstrateAccountInfo, SubstrateChainConfig, TaostatsTransaction } from '../types.ts';
import { SUBSTRATE_CHAINS } from '../types.ts';

export interface SubstrateRawData {
  accountInfo?: SubstrateAccountInfo;
  balance?: string;
  currency?: string;
  data: SubscanTransfer[] | TaostatsTransaction[] | unknown[];
  provider: 'subscan' | 'taostats' | 'rpc' | 'unknown';
  reserved?: string;
  since?: number;
}

@RegisterProcessor('subscan')
export class SubstrateProcessor implements IProviderProcessor<SubstrateRawData> {
  private static convertSubscanTransaction(
    transfer: SubscanTransfer,
    userAddress: string,
    chainConfig: SubstrateChainConfig
  ): BlockchainTransaction | null {
    try {
      const isFromUser = transfer.from === userAddress;
      const isToUser = transfer.to === userAddress;

      if (!isFromUser && !isToUser) {
        return null; // Not relevant to this address
      }

      const amount = new Decimal(transfer.amount || '0');
      const divisor = new Decimal(10).pow(chainConfig.tokenDecimals);
      const amountInMainUnit = amount.dividedBy(divisor);

      const fee = new Decimal(transfer.fee || '0');
      const feeInMainUnit = fee.dividedBy(divisor);

      const type = isFromUser ? 'transfer_out' : 'transfer_in';

      return {
        blockHash: transfer.block_hash || '',
        blockNumber: transfer.block_num || 0,
        confirmations: 1,
        fee: createMoney(feeInMainUnit.toNumber(), chainConfig.tokenSymbol),
        from: transfer.from,
        hash: transfer.hash,
        status: transfer.success ? 'success' : 'failed',
        timestamp: transfer.block_timestamp * 1000, // Convert to milliseconds
        to: transfer.to,
        type,
        value: createMoney(amountInMainUnit.toNumber(), chainConfig.tokenSymbol),
      };
    } catch (error) {
      console.warn(`Failed to convert Subscan transaction - Transfer: ${JSON.stringify(transfer)}, Error: ${error}`);
      return null;
    }
  }

  private static convertTaostatsTransaction(
    tx: TaostatsTransaction,
    userAddress: string
  ): BlockchainTransaction | null {
    try {
      const isFromUser = tx.from === userAddress;
      const isToUser = tx.to === userAddress;

      if (!isFromUser && !isToUser) {
        return null; // Not relevant to this address
      }

      const amount = new Decimal(tx.amount || '0');
      const fee = new Decimal(tx.fee || '0');

      const type = isFromUser ? 'transfer_out' : 'transfer_in';

      return {
        blockHash: tx.block_hash || '',
        blockNumber: tx.block_number || 0,
        confirmations: tx.confirmations || 1,
        fee: createMoney(fee.toNumber(), 'TAO'),
        from: tx.from,
        hash: tx.hash,
        status: tx.success ? 'success' : 'failed',
        timestamp: new Date(tx.timestamp).getTime(),
        to: tx.to,
        type,
        value: createMoney(amount.toNumber(), 'TAO'),
      };
    } catch (error) {
      console.warn(`Failed to convert Taostats transaction - Tx: ${JSON.stringify(tx)}, Error: ${error}`);
      return null;
    }
  }

  static processAddressBalance(rawData: SubstrateRawData): Balance[] {
    if (rawData.accountInfo) {
      // RPC-based balance
      const chainConfig = SUBSTRATE_CHAINS['polkadot']!;
      return this.processRpcBalance(rawData.accountInfo, chainConfig);
    } else if (rawData.balance !== undefined) {
      // Explorer-based balance
      if (rawData.currency === 'TAO') {
        return this.processTaostatsBalance(rawData);
      } else {
        const chainConfig = SUBSTRATE_CHAINS['polkadot']!;
        return this.processSubscanBalance(rawData, chainConfig);
      }
    }

    return [];
  }

  static processAddressTransactions(rawData: SubstrateRawData, userAddress: string): BlockchainTransaction[] {
    const transactions: BlockchainTransaction[] = [];

    // Default to polkadot chain config (could be enhanced to detect chain dynamically)
    const chainConfig = SUBSTRATE_CHAINS['polkadot']!;

    if (rawData.provider === 'subscan' && Array.isArray(rawData.data)) {
      for (const transfer of rawData.data as SubscanTransfer[]) {
        const blockchainTx = this.convertSubscanTransaction(transfer, userAddress, chainConfig);
        if (blockchainTx && (!rawData.since || blockchainTx.timestamp >= rawData.since)) {
          transactions.push(blockchainTx);
        }
      }
    } else if (rawData.provider === 'taostats' && Array.isArray(rawData.data)) {
      for (const tx of rawData.data as TaostatsTransaction[]) {
        const blockchainTx = this.convertTaostatsTransaction(tx, userAddress);
        if (blockchainTx && (!rawData.since || blockchainTx.timestamp >= rawData.since)) {
          transactions.push(blockchainTx);
        }
      }
    }

    return transactions;
  }

  private static processRpcBalance(accountInfo: SubstrateAccountInfo, chainConfig: SubstrateChainConfig): Balance[] {
    const freeBalance = new Decimal(accountInfo.data.free);
    const reservedBalance = new Decimal(accountInfo.data.reserved);
    const totalBalance = freeBalance.plus(reservedBalance);

    // Convert from smallest unit to main unit using chain decimals
    const divisor = new Decimal(10).pow(chainConfig.tokenDecimals);
    const balanceInMainUnit = totalBalance.dividedBy(divisor);
    const freeInMainUnit = freeBalance.dividedBy(divisor);
    const reservedInMainUnit = reservedBalance.dividedBy(divisor);

    return [
      {
        balance: freeInMainUnit.toNumber(),
        currency: chainConfig.tokenSymbol,
        total: balanceInMainUnit.toNumber(),
        used: reservedInMainUnit.toNumber(),
      },
    ];
  }

  private static processSubscanBalance(rawData: SubstrateRawData, chainConfig: SubstrateChainConfig): Balance[] {
    const freeBalance = new Decimal(rawData.balance || '0');
    const reservedBalance = new Decimal(rawData.reserved || '0');
    const totalBalance = freeBalance.plus(reservedBalance);

    const divisor = new Decimal(10).pow(chainConfig.tokenDecimals);
    const balanceInMainUnit = totalBalance.dividedBy(divisor);
    const freeInMainUnit = freeBalance.dividedBy(divisor);
    const reservedInMainUnit = reservedBalance.dividedBy(divisor);

    return [
      {
        balance: freeInMainUnit.toNumber(),
        currency: chainConfig.tokenSymbol,
        total: balanceInMainUnit.toNumber(),
        used: reservedInMainUnit.toNumber(),
      },
    ];
  }

  private static processTaostatsBalance(rawData: SubstrateRawData): Balance[] {
    const balance = new Decimal(rawData.balance || '0');

    return [
      {
        balance: balance.toNumber(),
        currency: 'TAO',
        total: balance.toNumber(),
        used: 0, // Taostats might not provide reserved balance
      },
    ];
  }

  // IProviderProcessor interface implementation
  transform(rawData: SubstrateRawData, walletAddresses: string[]): UniversalTransaction {
    // Process the first transaction for interface compatibility
    const userAddress = walletAddresses[0] || '';

    if (!rawData.data || rawData.data.length === 0) {
      throw new Error('No transactions to transform from SubstrateRawData');
    }

    const transactions = SubstrateProcessor.processAddressTransactions(rawData, userAddress);

    if (transactions.length === 0) {
      throw new Error('No relevant transactions found for user address');
    }

    const bcTx = transactions[0]; // Take the first processed transaction

    // Convert to UniversalTransaction following Bitcoin pattern
    let type: UniversalTransaction['type'];
    if (bcTx.type === 'transfer_in') {
      type = 'deposit';
    } else if (bcTx.type === 'transfer_out') {
      type = 'withdrawal';
    } else {
      type = 'transfer';
    }

    return {
      amount: bcTx.value,
      datetime: new Date(bcTx.timestamp).toISOString(),
      fee: bcTx.fee,
      from: bcTx.from,
      id: bcTx.hash,
      metadata: {
        blockchain: 'polkadot',
        blockNumber: bcTx.blockNumber,
        providerId: 'subscan',
        rawData: bcTx,
      },
      source: 'polkadot',
      status: bcTx.status === 'success' ? 'ok' : 'failed',
      symbol: bcTx.value.currency,
      timestamp: bcTx.timestamp,
      to: bcTx.to,
      type,
    };
  }

  validate(rawData: SubstrateRawData): ValidationResult {
    const errors: string[] = [];

    // Validate the structure
    if (!rawData || typeof rawData !== 'object') {
      errors.push('Raw data must be a SubstrateRawData object');
      return { errors, isValid: false };
    }

    if (!Array.isArray(rawData.data)) {
      errors.push('Data must be an array');
      return { errors, isValid: false };
    }

    if (!rawData.provider || !['subscan', 'taostats', 'rpc', 'unknown'].includes(rawData.provider)) {
      errors.push('Provider must be one of: subscan, taostats, rpc, unknown');
    }

    // Validate based on provider type
    if (rawData.provider === 'subscan') {
      for (let i = 0; i < rawData.data.length; i++) {
        const transfer = rawData.data[i] as SubscanTransfer;
        const prefix = `Subscan transfer ${i}:`;

        if (!transfer.hash) {
          errors.push(`${prefix} Transaction hash is required`);
        }

        if (!transfer.from) {
          errors.push(`${prefix} From address is required`);
        }

        if (!transfer.to) {
          errors.push(`${prefix} To address is required`);
        }

        if (!transfer.block_timestamp || typeof transfer.block_timestamp !== 'number') {
          errors.push(`${prefix} Block timestamp is required and must be a number`);
        }
      }
    } else if (rawData.provider === 'taostats') {
      for (let i = 0; i < rawData.data.length; i++) {
        const tx = rawData.data[i] as TaostatsTransaction;
        const prefix = `Taostats transaction ${i}:`;

        if (!tx.hash) {
          errors.push(`${prefix} Transaction hash is required`);
        }

        if (!tx.from) {
          errors.push(`${prefix} From address is required`);
        }

        if (!tx.to) {
          errors.push(`${prefix} To address is required`);
        }

        if (!tx.timestamp) {
          errors.push(`${prefix} Timestamp is required`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      ...(errors.length > 0 && { errors }),
    };
  }
}
