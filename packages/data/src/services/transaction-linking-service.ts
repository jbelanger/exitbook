import { getLogger } from '@crypto/shared-logger';

import { WalletRepository } from '../repositories/wallet-repository.ts';
import type { WalletAddress } from '../types/data-types.js';

export class TransactionLinkingService {
  private logger = getLogger('TransactionLinkingService');
  private walletRepository: WalletRepository;

  constructor(walletRepository: WalletRepository) {
    this.walletRepository = walletRepository;
  }

  async findWalletIdForTransaction(fromAddress?: string, toAddress?: string): Promise<number | null> {
    let walletId: number | null = null;

    if (fromAddress) {
      const wallet = await this.findWalletForAddress(fromAddress);
      if (wallet) {
        walletId = wallet.id;
      }
    }

    if (!walletId && toAddress) {
      const wallet = await this.findWalletForAddress(toAddress);
      if (wallet) {
        walletId = wallet.id;
      }
    }

    return walletId;
  }

  private async findWalletForAddress(address: string): Promise<WalletAddress | null> {
    const possibleBlockchains = ['injective', 'ethereum', 'bitcoin'];

    for (const blockchain of possibleBlockchains) {
      const normalizedAddress = this.normalizeAddress(address, blockchain);
      const wallet = await this.walletRepository.findByAddressNormalized(normalizedAddress, blockchain);
      if (wallet) {
        return wallet;
      }
    }

    return null;
  }

  private normalizeAddress(address: string, blockchain: string): string {
    return blockchain === 'ethereum' ? address.toLowerCase() : address;
  }
}
