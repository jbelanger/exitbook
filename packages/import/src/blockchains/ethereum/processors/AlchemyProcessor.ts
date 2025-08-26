import type { Balance, BlockchainTransaction, UniversalTransaction } from '@crypto/core';
import { type Result, createMoney, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { AlchemyAssetTransferSchema } from '../schemas.ts';
import type { AlchemyAssetTransfer, EtherscanBalance } from '../types.ts';

@RegisterProcessor('alchemy')
export class AlchemyProcessor implements IProviderProcessor<AlchemyAssetTransfer> {
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
  transform(rawData: AlchemyAssetTransfer, walletAddresses: string[]): Result<UniversalTransaction> {
    const userAddress = walletAddresses[0] || '';

    const isFromUser = rawData.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = rawData.to.toLowerCase() === userAddress.toLowerCase();

    // Determine transaction type based on Bitcoin pattern
    let type: UniversalTransaction['type'];
    if (isFromUser && isToUser) {
      type = 'transfer';
    } else if (isFromUser) {
      type = 'withdrawal';
    } else {
      type = 'deposit';
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

    return {
      success: true,
      value: {
        amount: createMoney(amount.toString(), currency),
        datetime: new Date(timestamp).toISOString(),
        fee: createMoney('0', 'ETH'),
        from: rawData.from,
        id: rawData.hash,
        metadata: {
          blockchain: 'ethereum',
          blockNumber: parseInt(rawData.blockNum, 16),
          providerId: 'alchemy',
          rawData: rawData,
        },
        source: 'ethereum',
        status: 'ok',
        symbol: currency,
        timestamp,
        to: rawData.to,
        type,
      },
    };
  }

  validate(rawData: AlchemyAssetTransfer): ValidationResult {
    const result = AlchemyAssetTransferSchema.safeParse(rawData);

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
