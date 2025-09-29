import type { WalletAddress } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';

import type { IWalletRepository } from '../ports/wallet-repository.js';

export class TransactionLinkingService {
  private logger = getLogger('TransactionLinkingService');
  private walletRepository: IWalletRepository;

  constructor(walletRepository: IWalletRepository) {
    this.walletRepository = walletRepository;
  }

  async findWalletIdForTransaction(fromAddress?: string, toAddress?: string): Promise<number | undefined> {
    let walletId: number | undefined = undefined;

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
  private async findWalletForAddress(address: string): Promise<WalletAddress | undefined> {
    const possibleBlockchains = ['injective', 'ethereum', 'bitcoin'];

    for (const blockchain of possibleBlockchains) {
      const normalizedAddress = this.normalizeAddress(address, blockchain);
      const wallet = await this.walletRepository.findByAddressNormalized(normalizedAddress, blockchain);
      if (wallet) {
        return wallet;
      }
    }

    return undefined;
  }

  private normalizeAddress(address: string, blockchain: string): string {
    return blockchain === 'ethereum' ? address.toLowerCase() : address;
  }
}
