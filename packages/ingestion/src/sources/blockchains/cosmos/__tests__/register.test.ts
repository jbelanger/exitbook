import { describe, expect, it } from 'vitest';

import { allBlockchainAdapters } from '../../index.js';
import { cosmosAdapters } from '../register.js';

describe('cosmos/register', () => {
  it('registers only Cosmos SDK chains with verified account-history support', () => {
    const cosmosAdapterNames = cosmosAdapters.map((adapter) => adapter.blockchain).sort();

    expect(cosmosAdapterNames).toEqual(['akash', 'fetch', 'injective']);
    expect(allBlockchainAdapters.some((adapter) => adapter.blockchain === 'cosmoshub')).toBe(false);
  });
});
