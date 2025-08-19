// CCXT adapter for backward compatibility
// @ts-ignore - CCXT types compatibility
import type { Exchange } from 'ccxt';
import type {
  ExchangeConfig
} from '../../../core/types/index';
import { BaseCCXTAdapter } from './base-ccxt-adapter';

export class CCXTAdapter extends BaseCCXTAdapter {
  constructor(exchange: Exchange, config: ExchangeConfig, enableOnlineVerification: boolean = false) {
    super(exchange, config, enableOnlineVerification, 'CCXTAdapter');
  }

  protected createExchange(): Exchange {
    // Exchange is already created and passed in constructor
    return this.exchange;
  }
}