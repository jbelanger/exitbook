import type { Balance, BlockchainTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { AlchemyAssetTransfer, EtherscanBalance } from '../types.ts';

const logger = getLogger('AlchemyProcessor');

export class AlchemyProcessor {
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
}
