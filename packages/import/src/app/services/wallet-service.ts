import type { CreateWalletAddressRequest } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';

import type { WalletRepository } from '../../infrastructure/persistence/wallet-repository.ts';

export class WalletService {
  private logger = getLogger('WalletService');
  private walletRepository: WalletRepository;

  constructor(walletRepository: WalletRepository) {
    this.walletRepository = walletRepository;
  }

  async createWalletAddressFromTransaction(
    address: string,
    blockchain: string,
    options?: {
      addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
      label?: string;
      notes?: string;
    }
  ): Promise<void> {
    try {
      const existingWallet = await this.walletRepository.findByAddress(address, blockchain);

      if (!existingWallet) {
        const walletRequest: CreateWalletAddressRequest = {
          address,
          addressType: options?.addressType || 'personal',
          blockchain,
          label: options?.label || `${blockchain} wallet`,
          notes: options?.notes || 'Added from CLI arguments',
        };

        await this.walletRepository.create(walletRequest);
        this.logger.info(`Created wallet address record for ${address} on ${blockchain}`);
      } else {
        this.logger.debug(`Wallet address ${address} already exists for ${blockchain}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error creating wallet address ${address} for ${blockchain}: ${errorMessage}`);
      throw error;
    }
  }
}
