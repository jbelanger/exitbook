import type { Exchange } from 'ccxt';
import { BaseCCXTAdapter } from '../adapters/universal/base-ccxt-adapter.js';
import type { UniversalExchangeAdapterConfig } from '@crypto/core';

export class CCXTAdapter extends BaseCCXTAdapter {
  constructor(exchange: Exchange, exchangeId: string, enableOnlineVerification: boolean = false) {
    const config: UniversalExchangeAdapterConfig = {
      type: 'exchange',
      id: exchangeId,
      subType: 'ccxt'
    };
    
    super(exchange, config, enableOnlineVerification);
  }

  protected createExchange(): Exchange {
    // Exchange is already created and passed in constructor
    return this.exchange;
  }
}