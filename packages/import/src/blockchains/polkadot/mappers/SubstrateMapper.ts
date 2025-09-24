import type { Balance } from '@crypto/core';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.js';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { UniversalBlockchainTransaction } from '../../shared/types.js';
import { SubscanTransferSchema } from '../schemas.js';
import type { SubscanTransfer, SubstrateAccountInfo, SubstrateChainConfig, TaostatsTransaction } from '../types.js';
import { SUBSTRATE_CHAINS } from '../types.js';

export interface SubstrateRawData {
  accountInfo?: SubstrateAccountInfo;
  balance?: string;
  currency?: string;
  data: SubscanTransfer[] | TaostatsTransaction[] | unknown[];
  provider: 'subscan' | 'taostats' | 'rpc' | 'unknown';
  reserved?: string;
  since?: number;
}

@RegisterTransactionMapper('subscan')
export class SubstrateTransactionMapper extends BaseRawDataMapper<SubscanTransfer> {
  static processAddressBalance(rawData: SubstrateRawData): Balance[] {
    if (rawData.accountInfo) {
      // RPC-based balance
      const chainConfig = SUBSTRATE_CHAINS['polkadot'];
      return this.processRpcBalance(rawData.accountInfo, chainConfig);
    } else if (rawData.balance !== undefined) {
      // Explorer-based balance
      if (rawData.currency === 'TAO') {
        return this.processTaostatsBalance(rawData);
      } else {
        const chainConfig = SUBSTRATE_CHAINS['polkadot'];
        return this.processSubscanBalance(rawData, chainConfig);
      }
    }

    return [];
  }

  static processAddressTransactions(rawData: SubstrateRawData, userAddress: string): UniversalBlockchainTransaction[] {
    const transactions: UniversalBlockchainTransaction[] = [];
    const userAddresses = new Set([userAddress]);

    // Default to polkadot chain config (could be enhanced to detect chain dynamically)
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];

    if (rawData.provider === 'subscan' && Array.isArray(rawData.data)) {
      for (const transfer of rawData.data as SubscanTransfer[]) {
        const blockchainTx = this.convertSubscanTransaction(transfer, userAddresses, chainConfig);
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

  private static convertSubscanTransaction(
    transfer: SubscanTransfer,
    relevantAddresses: Set<string>,
    chainConfig: SubstrateChainConfig
  ): UniversalBlockchainTransaction | undefined {
    try {
      const isFromUser = relevantAddresses.has(transfer.from);
      const isToUser = relevantAddresses.has(transfer.to);

      if (!isFromUser && !isToUser) {
        return undefined; // Not relevant to this address
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
      console.warn(
        `Failed to convert Subscan transaction - Transfer: ${JSON.stringify(transfer)}, Error: ${String(error)}`
      );
      return undefined;
    }
  }

  private static convertTaostatsTransaction(
    tx: TaostatsTransaction,
    userAddress: string
  ): UniversalBlockchainTransaction | undefined {
    try {
      const isFromUser = tx.from === userAddress;
      const isToUser = tx.to === userAddress;

      if (!isFromUser && !isToUser) {
        return undefined; // Not relevant to this address
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
      console.warn(`Failed to convert Taostats transaction - Tx: ${JSON.stringify(tx)}, Error: ${String(error)}`);
      return undefined;
    }
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
  protected readonly schema = SubscanTransferSchema;
  protected mapInternal(
    rawData: SubscanTransfer,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    // Extract addresses from rich session context (similar to Bitcoin's approach)
    // Use derivedAddresses for SS58 variants, fallback to address for backward compatibility
    const addresses = sessionContext.derivedAddresses || (sessionContext.address ? [sessionContext.address] : []);
    const relevantAddresses = new Set(addresses);
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];

    // Check if transaction involves any of our addresses
    const isFromUser = relevantAddresses.has(rawData.from);
    const isToUser = relevantAddresses.has(rawData.to);

    if (!isFromUser && !isToUser) {
      return err(`Transaction not relevant to user addresses: ${Array.from(relevantAddresses).join(', ')}`);
    }

    // Convert single SubscanTransfer directly to UniversalBlockchainTransaction
    // Pass all relevant addresses for proper matching
    const transaction = SubstrateTransactionMapper.convertSubscanTransaction(rawData, relevantAddresses, chainConfig);

    if (!transaction) {
      return err(`Failed to convert transaction for addresses: ${Array.from(relevantAddresses).join(', ')}`);
    }

    return ok([transaction]);
  }
}
