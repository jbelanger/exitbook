import type { Balance, BlockchainTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { MoralisTransactionSchema } from '../schemas.ts';
import type { MoralisNativeBalance, MoralisTokenBalance, MoralisTokenTransfer, MoralisTransaction } from '../types.ts';

@RegisterProcessor('moralis')
export class MoralisProcessor extends BaseProviderProcessor<MoralisTransaction> {
  protected readonly schema = MoralisTransactionSchema;
  private static convertNativeTransaction(tx: MoralisTransaction, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from_address.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to_address.toLowerCase() === userAddress.toLowerCase();

    let type: 'transfer_in' | 'transfer_out';
    if (isFromUser && isToUser) {
      type = 'transfer_in';
    } else if (isFromUser) {
      type = 'transfer_out';
    } else {
      type = 'transfer_in';
    }

    const valueWei = new Decimal(tx.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));

    return {
      blockHash: tx.block_hash,
      blockNumber: parseInt(tx.block_number),
      fee: createMoney(0, 'ETH'),
      from: tx.from_address,
      gasPrice: new Decimal(tx.gas_price).toNumber(),
      gasUsed: parseInt(tx.receipt_gas_used),
      hash: tx.hash,
      status: tx.receipt_status === '1' ? 'success' : 'failed',
      timestamp: new Date(tx.block_timestamp).getTime(),
      to: tx.to_address,
      type,
      value: createMoney(valueEth.toNumber(), 'ETH'),
    };
  }

  private static convertTokenTransfer(tx: MoralisTokenTransfer, userAddress: string): BlockchainTransaction {
    const isFromUser = tx.from_address.toLowerCase() === userAddress.toLowerCase();
    const isToUser = tx.to_address.toLowerCase() === userAddress.toLowerCase();

    let type: 'token_transfer_in' | 'token_transfer_out';
    if (isFromUser && isToUser) {
      type = 'token_transfer_in';
    } else if (isFromUser) {
      type = 'token_transfer_out';
    } else {
      type = 'token_transfer_in';
    }

    const decimals = parseInt(tx.token_decimals);
    const valueRaw = new Decimal(tx.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));

    return {
      blockHash: '',
      blockNumber: parseInt(tx.block_number),
      fee: createMoney(0, 'ETH'),
      from: tx.from_address,
      hash: tx.transaction_hash,
      status: 'success' as const,
      timestamp: new Date(tx.block_timestamp).getTime(),
      to: tx.to_address,
      tokenContract: tx.address,
      tokenSymbol: tx.token_symbol,
      type,
      value: createMoney(value.toNumber(), tx.token_symbol),
    };
  }

  static processAddressBalance(balance: MoralisNativeBalance): Balance[] {
    const balanceWei = new Decimal(balance.balance);
    const balanceEth = balanceWei.dividedBy(new Decimal(10).pow(18));

    return [
      {
        balance: balanceEth.toNumber(),
        currency: 'ETH',
        total: balanceEth.toNumber(),
        used: 0,
      },
    ];
  }

  static processAddressTransactions(transactions: MoralisTransaction[], userAddress: string): BlockchainTransaction[] {
    return transactions.map(tx => this.convertNativeTransaction(tx, userAddress));
  }

  static processTokenBalances(balances: MoralisTokenBalance[]): Balance[] {
    const processedBalances: Balance[] = [];

    for (const tokenBalance of balances) {
      if (tokenBalance.balance && tokenBalance.balance !== '0') {
        const balance = new Decimal(tokenBalance.balance);
        const decimals = tokenBalance.decimals || 18;
        const symbol = tokenBalance.symbol || 'UNKNOWN';

        const adjustedBalance = balance.dividedBy(new Decimal(10).pow(decimals));

        processedBalances.push({
          balance: adjustedBalance.toNumber(),
          contractAddress: tokenBalance.token_address,
          currency: symbol,
          total: adjustedBalance.toNumber(),
          used: 0,
        });
      }
    }

    return processedBalances;
  }

  static processTokenTransactions(transfers: MoralisTokenTransfer[], userAddress: string): BlockchainTransaction[] {
    return transfers.map(tx => this.convertTokenTransfer(tx, userAddress));
  }

  // IProviderProcessor interface implementation
  protected transformValidated(
    rawData: MoralisTransaction,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    // Extract addresses from rich session context
    const addresses = sessionContext.addresses || sessionContext.contractAddresses || [];
    const userAddress = addresses[0] || '';

    const isFromUser = rawData.from_address.toLowerCase() === userAddress.toLowerCase();
    const isToUser = rawData.to_address.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type - ETH native transfers are just transfers
    const type: UniversalBlockchainTransaction['type'] = 'transfer';

    const valueWei = parseDecimal(rawData.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));
    const timestamp = new Date(rawData.block_timestamp).getTime();

    const transaction: UniversalBlockchainTransaction = {
      amount: valueEth.toString(),
      blockHeight: parseInt(rawData.block_number),
      currency: 'ETH',
      from: rawData.from_address,
      id: rawData.hash,
      providerId: 'moralis',
      status: rawData.receipt_status === '1' ? 'success' : 'failed',
      timestamp,
      to: rawData.to_address,
      type,
    };

    return ok(transaction);
  }
}
