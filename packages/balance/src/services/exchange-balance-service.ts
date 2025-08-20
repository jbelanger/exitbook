import type { IExchangeAdapter } from '@crypto/core';
import type { IBalanceService, ServiceCapabilities } from './balance-service.js';

export class ExchangeBalanceService implements IBalanceService {
  private _cachedId?: string;
  private _cachedCapabilities?: ServiceCapabilities;

  constructor(private adapter: IExchangeAdapter) {}

  async initialize(): Promise<void> {
    const info = await this.adapter.getExchangeInfo();
    this._cachedId = info.id;
    this._cachedCapabilities = {
      fetchBalance: info.capabilities.fetchBalance,
      name: info.name,
      version: info.version
    };
  }

  getServiceId(): string {
    return this._cachedId || 'unknown';
  }

  async getBalances(): Promise<Record<string, number>> {
    const balances = await this.adapter.fetchBalance();
    const balanceObj: Record<string, number> = {};

    for (const balance of balances) {
      if (balance.currency && balance.total !== undefined) {
        balanceObj[balance.currency] = balance.total;
      }
    }

    return balanceObj;
  }

  supportsLiveBalanceFetching(): boolean {
    return this._cachedCapabilities?.fetchBalance ?? true;
  }

  getCapabilities(): ServiceCapabilities {
    return this._cachedCapabilities || {
      fetchBalance: true,
      name: 'Unknown Exchange'
    };
  }

  async testConnection(): Promise<boolean> {
    return await this.adapter.testConnection();
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}