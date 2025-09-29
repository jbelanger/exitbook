import type { NewWalletAddress } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';

import type { IWalletRepository } from '../ports/wallet-repository.js';

export class WalletService {
  private logger = getLogger('WalletService');
  private walletRepository: IWalletRepository;

  constructor(walletRepository: IWalletRepository) {
    this.walletRepository = walletRepository;
  }

  async createWalletAddressFromTransaction(
    address: string,
    blockchain: string,
    options?: {
      addressType?: 'personal' | 'exchange' | 'contract' | 'unknown' | undefined;
      label?: string | undefined;
      notes?: string | undefined;
    }
  ): Promise<void> {
    try {
      const existingWallet = await this.walletRepository.findByAddress(address, blockchain);

      if (!existingWallet) {
        const walletRequest: NewWalletAddress = {
          address,
          address_type: options?.addressType || 'personal',
          blockchain,
          created_at: new Date(),
          is_active: true,
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
