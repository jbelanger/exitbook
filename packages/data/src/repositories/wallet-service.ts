import type { CreateWalletAddressRequest } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { Database } from '../storage/database.ts';

/**
 * Service to handle simple wallet address creation and management
 */
export class WalletService {
  private logger = getLogger('WalletService');
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /**
   * Create a simple wallet address record
   */
  async createWalletAddressFromTransaction(address: string, blockchain: string, options?: {
    label?: string;
    addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
    notes?: string;
  }): Promise<void> {
    try {
      // Check if wallet address already exists
      const existingWallet = await this.database.findWalletAddressByAddress(address, blockchain);

      if (!existingWallet) {
        // Create new wallet address record
        const walletRequest: CreateWalletAddressRequest = {
          address,
          blockchain,
          label: options?.label || `${blockchain} wallet`,
          addressType: options?.addressType || 'personal',
          notes: options?.notes || 'Added from CLI arguments'
        };

        await this.database.addWalletAddress(walletRequest);
        this.logger.info(`Created wallet address record for ${address} on ${blockchain}`);
      } else {
        this.logger.debug(`Wallet address ${address} already exists for ${blockchain}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error creating wallet address ${address} for ${blockchain}`, { error: errorMessage });
      throw error; // Re-throw to let caller handle it
    }
  }
}