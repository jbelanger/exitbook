import { describe, expect, it } from 'vitest';

import { getCosmosChainConfig } from '../../../chain-registry.js';
import { mapCosmosRestTransaction } from '../cosmos-rest.mapper-utils.js';
import type { CosmosTxResponse } from '../cosmos-rest.schemas.js';

const COSMOSHUB_CONFIG = getCosmosChainConfig('cosmoshub');

if (!COSMOSHUB_CONFIG) {
  throw new Error('Missing cosmoshub chain config');
}

describe('mapCosmosRestTransaction', () => {
  it('preserves IBC denom identity on bank sends', () => {
    const denom = 'ibc/B0845B48D3CA9F66B4E2DD610B39E36A7A7CFACA2629D9BA880241AE5688B61D';
    const raw: CosmosTxResponse = {
      code: 0,
      events: [],
      gas_used: '80000',
      gas_wanted: '100000',
      height: '30833238',
      timestamp: '2026-04-26T03:25:00Z',
      tx: {
        auth_info: {
          fee: {
            amount: [{ amount: '1000', denom: 'uatom' }],
            gas_limit: '100000',
          },
        },
        body: {
          messages: [
            {
              '@type': '/cosmos.bank.v1beta1.MsgSend',
              amount: [{ amount: '11060777744', denom }],
              from_address: 'cosmos1from0000000000000000000000000000000',
              to_address: 'cosmos1to000000000000000000000000000000000',
            },
          ],
        },
        signatures: [],
      },
      txhash: '37578399F5A8DDE09E77F579CCD96DDA246BA6FBC81B482D4846D50AC326C400',
    };

    const result = mapCosmosRestTransaction(
      raw,
      'cosmos1to000000000000000000000000000000000',
      'cosmos-rest',
      COSMOSHUB_CONFIG
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }
    expect(result.value).toMatchObject({
      amount: '11060.777744',
      bridgeType: 'native',
      currency: `IBC/${denom.slice(4)}`,
      tokenAddress: denom.toLowerCase(),
      tokenSymbol: `IBC/${denom.slice(4)}`,
      tokenType: 'ibc',
    });
  });
});
