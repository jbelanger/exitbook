import type { Balance, BlockchainTransaction, UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { IProviderProcessor, ValidationResult } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { AlchemyAssetTransferArraySchema } from '../schemas.ts';
import type { AlchemyAssetTransfer, EtherscanBalance } from '../types.ts';

@RegisterProcessor('alchemy')
export class AlchemyProcessor implements IProviderProcessor<AlchemyAssetTransfer[]> {
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
  transform(rawData: AlchemyAssetTransfer[], walletAddresses: string[]): UniversalTransaction {
    // Note: This interface expects single transaction but Alchemy returns arrays
    // This is a temporary implementation for architectural consistency
    // The array processing is handled by the bridge pattern in the adapter
    if (!rawData || rawData.length === 0) {
      throw new Error('No asset transfers provided to AlchemyProcessor.transform');
    }

    // Process the first transfer as a single transaction for interface compatibility
    const transfer = rawData[0];
    const userAddress = walletAddresses[0] || '';

    const isFromUser = transfer.from.toLowerCase() === userAddress.toLowerCase();
    const isToUser = transfer.to.toLowerCase() === userAddress.toLowerCase();

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
    let amount = parseDecimal(transfer.value || '0');

    if (transfer.category === 'token') {
      currency = transfer.asset || 'UNKNOWN';
      if (transfer.rawContract?.decimal) {
        const decimals = parseInt(transfer.rawContract.decimal);
        amount = amount.dividedBy(new Decimal(10).pow(decimals));
      }
    }

    const timestamp = transfer.metadata?.blockTimestamp
      ? new Date(transfer.metadata.blockTimestamp).getTime()
      : Date.now();

    return {
      amount: createMoney(amount.toString(), currency),
      datetime: new Date(timestamp).toISOString(),
      fee: createMoney(0, 'ETH'),
      from: transfer.from,
      id: transfer.hash,
      metadata: {
        blockchain: 'ethereum',
        blockNumber: parseInt(transfer.blockNum, 16),
        providerId: 'alchemy',
        rawData: transfer,
      },
      source: 'ethereum',
      status: 'ok',
      symbol: currency,
      timestamp,
      to: transfer.to,
      type,
    };
  }

  validate(rawData: AlchemyAssetTransfer[]): ValidationResult {
    const result = AlchemyAssetTransferArraySchema.safeParse(rawData);

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
