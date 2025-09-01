import type { Balance } from '@crypto/core';
import { parseDecimal } from '@crypto/shared-utils';
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
  private static convertNativeTransaction(tx: MoralisTransaction): UniversalBlockchainTransaction {
    const valueWei = parseDecimal(tx.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));
    const timestamp = new Date(tx.block_timestamp).getTime();

    // Calculate gas fee
    const gasPrice = parseDecimal(tx.gas_price);
    const gasUsed = parseDecimal(tx.receipt_gas_used);
    const feeWei = gasPrice.mul(gasUsed);
    const feeEth = feeWei.dividedBy(new Decimal(10).pow(18));

    return {
      amount: valueEth.toString(),
      blockHeight: parseInt(tx.block_number),
      blockId: tx.block_hash,
      currency: 'ETH',
      feeAmount: feeEth.toString(),
      feeCurrency: 'ETH',
      from: tx.from_address,
      id: tx.hash,
      providerId: 'moralis',
      status: tx.receipt_status === '1' ? 'success' : 'failed',
      timestamp,
      to: tx.to_address,
      type: 'transfer',
    };
  }

  private static convertTokenTransfer(tx: MoralisTokenTransfer): UniversalBlockchainTransaction {
    const decimals = parseInt(tx.token_decimals);
    const valueRaw = parseDecimal(tx.value);
    const value = valueRaw.dividedBy(new Decimal(10).pow(decimals));
    const timestamp = new Date(tx.block_timestamp).getTime();

    return {
      amount: value.toString(),
      blockHeight: parseInt(tx.block_number),
      currency: tx.token_symbol,
      from: tx.from_address,
      id: tx.transaction_hash,
      providerId: 'moralis',
      status: 'success',
      timestamp,
      to: tx.to_address,
      tokenAddress: tx.address,
      tokenDecimals: decimals,
      tokenSymbol: tx.token_symbol,
      type: 'token_transfer',
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

  static processAddressTransactions(transactions: MoralisTransaction[]): UniversalBlockchainTransaction[] {
    return transactions.map(tx => this.convertNativeTransaction(tx));
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

  static processTokenTransactions(transfers: MoralisTokenTransfer[]): UniversalBlockchainTransaction[] {
    return transfers.map(tx => this.convertTokenTransfer(tx));
  }

  // IProviderProcessor interface implementation
  protected transformValidated(
    rawData: MoralisTransaction,
    _sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
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

    return ok([transaction]);
  }
}
