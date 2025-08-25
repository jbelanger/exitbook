import type { IUniversalAdapter } from '@crypto/core';

import type { IBalanceService, ServiceCapabilities } from './balance-service.js';

export class ExchangeBalanceService implements IBalanceService {
  private _cachedCapabilities?: ServiceCapabilities;
  private _cachedId?: string;

  constructor(private adapter: IUniversalAdapter) {}

  async close(): Promise<void> {
    await this.adapter.close();
  }

  async getBalances(): Promise<Record<string, number>> {
    const balances = await this.adapter.fetchBalances({});
    const balanceObj: Record<string, number> = {};

    for (const balance of balances) {
      if (balance.currency && balance.total !== undefined) {
        balanceObj[balance.currency] = balance.total;
      }
    }

    return balanceObj;
  }

  getCapabilities(): ServiceCapabilities {
    return (
      this._cachedCapabilities || {
        fetchBalance: true,
        name: 'Unknown Exchange',
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
      version: '1.0.0', // Universal adapters don't have version in the same way
    };
  }

  supportsLiveBalanceFetching(): boolean {
    return this._cachedCapabilities?.fetchBalance ?? true;
  }

  async testConnection(): Promise<boolean> {
    return await this.adapter.testConnection();
  }
}
