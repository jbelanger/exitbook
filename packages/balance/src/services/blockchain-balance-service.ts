import type { IUniversalAdapter } from '@crypto/core';

import type { IBalanceService, ServiceCapabilities } from './balance-service.js';

export class BlockchainBalanceService implements IBalanceService {
  private _cachedCapabilities?: ServiceCapabilities;
  private _cachedId?: string;

  constructor(
    private adapter: IUniversalAdapter,
    private addresses: string[]
  ) {}

  async close(): Promise<void> {
    await this.adapter.close();
  }

  async getBalances(): Promise<Record<string, number>> {
    const aggregatedBalances: Record<string, number> = {};

    try {
      // Use the universal fetchBalances method with all addresses
      const balances = await this.adapter.fetchBalances({
        addresses: this.addresses,
      });

      for (const balance of balances) {
        const currency = balance.currency;
        aggregatedBalances[currency] = (aggregatedBalances[currency] || 0) + balance.total;
      }
    } catch (error) {
      // Log error but continue
      console.warn(`Failed to fetch balances for addresses:`, error);
    }

    return aggregatedBalances;
  }

  getCapabilities(): ServiceCapabilities {
    return (
      this._cachedCapabilities || {
        fetchBalance: true,
        name: 'Unknown Blockchain',
      }
    );
  }

  getServiceId(): string {
    return this._cachedId || 'unknown';
  }

  async initialize(): Promise<void> {
    const info = await this.adapter.getInfo();
    this._cachedId = info.id;
    this._cachedCapabilities = {
      fetchBalance: info.capabilities.supportedOperations.includes('fetchBalances'),
      name: info.name,
    };
  }

  supportsLiveBalanceFetching(): boolean {
    return this._cachedCapabilities?.fetchBalance ?? true;
  }

  async testConnection(): Promise<boolean> {
    return await this.adapter.testConnection();
  }
}
