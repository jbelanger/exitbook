import type { Exchange } from 'ccxt';
import { BaseCCXTAdapter } from './base-ccxt-adapter.ts';

export class CCXTAdapter extends BaseCCXTAdapter {
  constructor(exchange: Exchange, exchangeId: string, enableOnlineVerification: boolean = false) {
    super(exchange, exchangeId, enableOnlineVerification, 'CCXTAdapter');
  }

  protected createExchange(): Exchange {
    // Exchange is already created and passed in constructor
    return this.exchange;
  }
}