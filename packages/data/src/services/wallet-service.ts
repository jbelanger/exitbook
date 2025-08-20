import type { CreateWalletAddressRequest } from '../types/data-types.js';
import { getLogger } from '@crypto/shared-logger';
import { WalletRepository } from '../repositories/wallet-repository.ts';

export class WalletService {
  private logger = getLogger('WalletService');
  private walletRepository: WalletRepository;

  constructor(walletRepository: WalletRepository) {
    this.walletRepository = walletRepository;
  }

  async createWalletAddressFromTransaction(address: string, blockchain: string, options?: {
    label?: string;
    addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
    notes?: string;
  }): Promise<void> {
    try {
      const existingWallet = await this.walletRepository.findByAddress(address, blockchain);

      if (!existingWallet) {
        const walletRequest: CreateWalletAddressRequest = {
          address,
          blockchain,
          label: options?.label || `${blockchain} wallet`,
          addressType: options?.addressType || 'personal',
          notes: options?.notes || 'Added from CLI arguments'
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