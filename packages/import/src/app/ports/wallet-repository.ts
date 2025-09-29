import type { NewWalletAddress, WalletAddressUpdate, WalletAddress } from '@crypto/data/src/types/data-types.ts';

export interface IWalletRepository {
  create(request: NewWalletAddress): Promise<void>;
  delete(id: number): Promise<boolean>;
  findByAddress(address: string, blockchain: string): Promise<WalletAddress | undefined>;
  findByAddressNormalized(normalizedAddress: string, blockchain: string): Promise<WalletAddress | undefined>;
  findById(id: number): Promise<WalletAddress | undefined>;
  update(id: number, updates: Partial<WalletAddressUpdate>): Promise<void>;
}
