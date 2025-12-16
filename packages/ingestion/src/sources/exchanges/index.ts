import { registerCoinbaseExchange } from './coinbase/register.js';
import { registerKrakenExchange } from './kraken/register.js';
import { registerKucoinExchange } from './kucoin/register.js';

export function registerAllExchanges(): void {
  registerKrakenExchange();
  registerCoinbaseExchange();
  registerKucoinExchange();
}
