import { registerCoinbaseExchange } from './coinbase/register.ts';
import { registerKrakenExchange } from './kraken/register.ts';
import { registerKucoinExchange } from './kucoin/register.ts';

export function registerAllExchanges(): void {
  registerKrakenExchange();
  registerCoinbaseExchange();
  registerKucoinExchange();
}
