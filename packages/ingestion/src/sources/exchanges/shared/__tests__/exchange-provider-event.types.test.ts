import { describe, expectTypeOf, it } from 'vitest';

import type { CoinbaseProviderEvent, CoinbaseProviderMetadata } from '../../coinbase/normalize-provider-event.js';
import type { KrakenProviderEvent, KrakenProviderMetadata } from '../../kraken/normalize-provider-event.js';
import type { KuCoinProviderEvent, KuCoinProviderMetadata } from '../../kucoin/normalize-provider-event.js';
import type { ExchangeProviderEvent } from '../exchange-provider-event.js';

describe('exchange provider event typing', () => {
  it('preserves provider metadata shapes through the shared event contract', () => {
    expectTypeOf<CoinbaseProviderEvent['providerMetadata']>().toEqualTypeOf<CoinbaseProviderMetadata>();
    expectTypeOf<KrakenProviderEvent['providerMetadata']>().toEqualTypeOf<KrakenProviderMetadata>();
    expectTypeOf<KuCoinProviderEvent['providerMetadata']>().toEqualTypeOf<KuCoinProviderMetadata>();
    expectTypeOf<ExchangeProviderEvent<CoinbaseProviderMetadata>>().toEqualTypeOf<CoinbaseProviderEvent>();
    expectTypeOf<ExchangeProviderEvent<KrakenProviderMetadata>>().toEqualTypeOf<KrakenProviderEvent>();
    expectTypeOf<ExchangeProviderEvent<KuCoinProviderMetadata>>().toEqualTypeOf<KuCoinProviderEvent>();
  });
});
