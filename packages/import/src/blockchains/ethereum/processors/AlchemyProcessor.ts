import type { Balance, BlockchainTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { AlchemyAssetTransferSchema } from '../schemas.ts';
import type { AlchemyAssetTransfer, EtherscanBalance } from '../types.ts';

@RegisterProcessor('alchemy')
export class AlchemyProcessor extends BaseProviderProcessor<AlchemyAssetTransfer> {
  protected readonly schema = AlchemyAssetTransferSchema;
  private static convertAssetTransfer(transfer: AlchemyAssetTransfer, userAddress: string): BlockchainTransaction {
    const isFromUser = transfer.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = transfer.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: 'transfer_in' | 'transfer_out' | 'token_transfer_in' | 'token_transfer_out';
    const isToken = transfer.category === 'token';

    if (isFromUser && isToUser) {
      type = isToken ? 'token_transfer_in' : 'transfer_in';
    } else if (isFromUser) {
      type = isToken ? 'token_transfer_out' : 'transfer_out';
    } else {
      type = isToken ? 'token_transfer_in' : 'transfer_in';
    }

    // Handle different asset types
    let currency = 'ETH';
    let amount = new Decimal(transfer.value || 0);

    if (transfer.category === 'token') {
      currency = transfer.asset || 'UNKNOWN';
      if (transfer.rawContract?.decimal) {
        const decimals = parseInt(transfer.rawContract.decimal);
        amount = amount.dividedBy(new Decimal(10).pow(decimals));
      }
    } else {
      currency = 'ETH';
    }

    const timestamp = transfer.metadata?.blockTimestamp
      ? new Date(transfer.metadata.blockTimestamp).getTime()
      : Date.now();

    return {
      blockHash: '',
      blockNumber: parseInt(transfer.blockNum, 16),
      fee: createMoney(0, 'ETH'),
      from: transfer.from,
      hash: transfer.hash,
      status: 'success' as const,
      timestamp,
      to: transfer.to,
      tokenContract: transfer.rawContract?.address,
      tokenSymbol: currency !== 'ETH' ? currency : undefined,
      type,
      value: createMoney(amount.toNumber(), currency),
    };
  }

  static processAddressBalance(balances: EtherscanBalance[]): Balance[] {
    return balances.map(balance => {
      const ethBalanceWei = new Decimal(balance.balance);
      const ethBalance = ethBalanceWei.dividedBy(new Decimal(10).pow(18));

      return {
        balance: ethBalance.toNumber(),
        currency: 'ETH',
        total: ethBalance.toNumber(),
        used: 0,
      };
    });
  }

  static processAddressTransactions(transfers: AlchemyAssetTransfer[], userAddress: string): BlockchainTransaction[] {
    return transfers.map(transfer => this.convertAssetTransfer(transfer, userAddress));
  }

  static processTokenTransactions(transfers: AlchemyAssetTransfer[], userAddress: string): BlockchainTransaction[] {
    return transfers.map(transfer => this.convertAssetTransfer(transfer, userAddress));
  }

  // IProviderProcessor interface implementation
  protected transformValidated(
    rawData: AlchemyAssetTransfer,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    // Extract addresses from rich session context
    const addresses = sessionContext.addresses || sessionContext.contractAddresses || [];
    const userAddress = addresses[0] || '';

    const isFromUser = rawData.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = rawData.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type
    let type: UniversalBlockchainTransaction['type'];
    if (rawData.category === 'token') {
      type = 'token_transfer';
    } else {
      type = 'transfer';
    }

    // Handle different asset types
    let currency = 'ETH';
    let amount = parseDecimal(String(rawData.value || 0));

    if (rawData.category === 'token') {
      currency = rawData.asset || 'UNKNOWN';
      if (rawData.rawContract?.decimal) {
        const decimals =
          typeof rawData.rawContract.decimal === 'number'
            ? rawData.rawContract.decimal
            : parseInt(String(rawData.rawContract.decimal));
        amount = amount.dividedBy(new Decimal(10).pow(decimals));
      }
    }

    const timestamp = rawData.metadata?.blockTimestamp
      ? new Date(rawData.metadata.blockTimestamp).getTime()
      : Date.now();

    const transaction: UniversalBlockchainTransaction = {
      amount: amount.toString(),
      blockHeight: parseInt(rawData.blockNum, 16),
      currency,
      from: rawData.from,
      id: rawData.hash,
      providerId: 'alchemy',
      status: 'success',
      timestamp,
      to: rawData.to,
      type,
    };

    // Add token-specific fields if it's a token transfer
    if (rawData.category === 'token' && rawData.rawContract?.address) {
      transaction.tokenAddress = rawData.rawContract.address;
      transaction.tokenSymbol = currency;
      if (rawData.rawContract.decimal) {
        const decimals =
          typeof rawData.rawContract.decimal === 'number'
            ? rawData.rawContract.decimal
            : parseInt(String(rawData.rawContract.decimal));
        transaction.tokenDecimals = decimals;
      }
    }

    return ok([transaction]);
  }
}
