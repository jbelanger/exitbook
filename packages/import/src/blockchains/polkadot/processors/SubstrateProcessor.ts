import type { Balance, BlockchainTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { SubscanTransferSchema } from '../schemas.ts';
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
export class SubstrateProcessor extends BaseProviderProcessor<SubscanTransfer> {
  protected readonly schema = SubscanTransferSchema;
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
  protected transformValidated(
    rawData: SubscanTransfer,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    // Extract addresses from rich session context
    const addresses = sessionContext.addresses || [];
    const userAddress = addresses[0] || '';
    const chainConfig = SUBSTRATE_CHAINS['polkadot']!;

    // Convert single SubscanTransfer to BlockchainTransaction
    const bcTx = SubstrateProcessor.convertSubscanTransaction(rawData, userAddress, chainConfig);

    if (!bcTx) {
      return err(`Transaction not relevant to user address: ${userAddress}`);
    }

    // Convert amounts to string format
    const amount = new Decimal(bcTx.value.amount.toString());
    const feeAmount = new Decimal(bcTx.fee.amount.toString());

    const transaction: UniversalBlockchainTransaction = {
      amount: amount.toString(),
      currency: bcTx.value.currency,
      from: bcTx.from,
      id: bcTx.hash,
      providerId: 'subscan',
      status: bcTx.status === 'success' ? 'success' : 'failed',
      timestamp: bcTx.timestamp,
      to: bcTx.to,
      type: 'transfer',
    };

    // Add optional fields
    if (bcTx.blockNumber > 0) {
      transaction.blockHeight = bcTx.blockNumber;
    }
    if (feeAmount.toNumber() > 0) {
      transaction.feeAmount = feeAmount.toString();
      transaction.feeCurrency = bcTx.fee.currency;
    }
    if (bcTx.blockHash) {
      transaction.blockId = bcTx.blockHash;
    }

    return ok([transaction]);
  }
}
