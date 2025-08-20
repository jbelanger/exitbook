import type { CreateWalletAddressRequest, UpdateWalletAddressRequest, WalletAddress, WalletAddressQuery } from '@crypto/core';
import { Database } from '../storage/database.ts';

export class WalletRepository {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async create(request: CreateWalletAddressRequest): Promise<WalletAddress> {
    return this.database.addWalletAddress(request);
  }

  async update(id: number, updates: UpdateWalletAddressRequest): Promise<WalletAddress | null> {
    return this.database.updateWalletAddress(id, updates);
  }

  async findById(id: number): Promise<WalletAddress | null> {
    return this.database.getWalletAddress(id);
  }

  async findByAddress(address: string, blockchain: string): Promise<WalletAddress | null> {
    return this.database.findWalletAddressByAddress(address, blockchain);
  }

  async findByAddressNormalized(normalizedAddress: string, blockchain: string): Promise<WalletAddress | null> {
    return this.database.findWalletAddressByAddressNormalized(normalizedAddress, blockchain);
  }

  async findAll(query?: WalletAddressQuery): Promise<WalletAddress[]> {
    return this.database.getWalletAddresses(query);
  }

  async delete(id: number): Promise<boolean> {
    return this.database.deleteWalletAddress(id);
  }

  async linkTransactionToWallets(transactionId: string, fromAddress?: string, toAddress?: string): Promise<void> {
    return this.database.linkTransactionToWallets(transactionId, fromAddress, toAddress);
  }
}