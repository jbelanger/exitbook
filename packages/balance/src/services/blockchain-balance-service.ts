import type { IBlockchainAdapter } from '@crypto/core';
import type { IBalanceService, ServiceCapabilities } from './balance-service.js';

export class BlockchainBalanceService implements IBalanceService {
  private _cachedId?: string;
  private _cachedCapabilities?: ServiceCapabilities;

  constructor(
    private adapter: IBlockchainAdapter,
    private addresses: string[]
  ) {}

  async initialize(): Promise<void> {
    const info = await this.adapter.getBlockchainInfo();
    this._cachedId = info.id;
    this._cachedCapabilities = {
      fetchBalance: info.capabilities.supportsBalanceQueries,
      name: info.name
    };
  }

  getServiceId(): string {
    return this._cachedId || 'unknown';
  }

  async getBalances(): Promise<Record<string, number>> {
    const aggregatedBalances: Record<string, number> = {};

    for (const address of this.addresses) {
      try {
        const balances = await this.adapter.getAddressBalance(address);
        
        for (const balance of balances) {
          const currency = balance.currency;
          aggregatedBalances[currency] = (aggregatedBalances[currency] || 0) + balance.total;
        }
      } catch (error) {
        // Log error but continue with other addresses
        console.warn(`Failed to fetch balance for address ${address}:`, error);
      }
    }

    return aggregatedBalances;
  }

  supportsLiveBalanceFetching(): boolean {
    return this._cachedCapabilities?.fetchBalance ?? true;
  }

  getCapabilities(): ServiceCapabilities {
    return this._cachedCapabilities || {
      fetchBalance: true,
      name: 'Unknown Blockchain'
    };
  }

  async testConnection(): Promise<boolean> {
    return await this.adapter.testConnection();
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}