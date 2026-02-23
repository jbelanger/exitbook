import { coinbaseAdapter } from './coinbase/register.js';
import { krakenAdapter } from './kraken/register.js';
import { kucoinAdapter } from './kucoin/register.js';

export const allExchangeAdapters = [krakenAdapter, coinbaseAdapter, kucoinAdapter];
