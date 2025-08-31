import type { Balance } from '@crypto/core';
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
  ): UniversalBlockchainTransaction | null {
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
        amount: amountInMainUnit.toString(),
        blockHeight: transfer.block_num || 0,
        blockId: transfer.block_hash || '',
        currency: chainConfig.tokenSymbol,
        feeAmount: feeInMainUnit.toString(),
        feeCurrency: chainConfig.tokenSymbol,
        from: transfer.from,
        id: transfer.hash,
        providerId: 'subscan',
        status: transfer.success ? 'success' : 'failed',
        timestamp: transfer.block_timestamp * 1000, // Convert to milliseconds
        to: transfer.to,
        type: type === 'transfer_out' ? 'transfer_out' : 'transfer_in',
      };
    } catch (error) {
      console.warn(`Failed to convert Subscan transaction - Transfer: ${JSON.stringify(transfer)}, Error: ${error}`);
      return null;
    }
  }

  private static convertTaostatsTransaction(
    tx: TaostatsTransaction,
    userAddress: string
  ): UniversalBlockchainTransaction | null {
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
        amount: amount.toString(),
        blockHeight: tx.block_number || 0,
        blockId: tx.block_hash || '',
        currency: 'TAO',
        feeAmount: fee.toString(),
        feeCurrency: 'TAO',
        from: tx.from,
        id: tx.hash,
        providerId: 'taostats',
        status: tx.success ? 'success' : 'failed',
        timestamp: new Date(tx.timestamp).getTime(),
        to: tx.to,
        type: type === 'transfer_out' ? 'transfer_out' : 'transfer_in',
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

  static processAddressTransactions(rawData: SubstrateRawData, userAddress: string): UniversalBlockchainTransaction[] {
    const transactions: UniversalBlockchainTransaction[] = [];

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

    // Convert single SubscanTransfer directly to UniversalBlockchainTransaction
    const transaction = SubstrateProcessor.convertSubscanTransaction(rawData, userAddress, chainConfig);

    if (!transaction) {
      return err(`Transaction not relevant to user address: ${userAddress}`);
    }

    return ok([transaction]);
  }
}
