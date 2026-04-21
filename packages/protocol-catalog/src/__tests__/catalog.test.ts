import { describe, expect, it } from 'vitest';

import { InMemoryProtocolCatalog, createSeedProtocolCatalog, type ProtocolCatalogEntry } from '../index.js';

const TEST_ENTRIES: readonly ProtocolCatalogEntry[] = [
  {
    protocol: { id: 'wormhole' },
    displayName: 'Wormhole',
    deployments: [{ chain: 'ethereum', addresses: ['0xAbC123'] }],
  },
  {
    protocol: { id: 'uniswap', version: 'v3' },
    displayName: 'Uniswap V3',
    deployments: [{ chain: 'arbitrum', addresses: ['0xdef456'] }],
  },
];

describe('InMemoryProtocolCatalog', () => {
  it('finds entries by stable protocol ref', () => {
    const catalog = new InMemoryProtocolCatalog(TEST_ENTRIES);

    expect(catalog.findByRef({ id: 'uniswap', version: 'v3' })).toEqual(TEST_ENTRIES[1]);
    expect(catalog.findByRef({ id: 'uniswap', version: 'v2' })).toBeUndefined();
  });

  it('matches addresses case-insensitively within a chain', () => {
    const catalog = new InMemoryProtocolCatalog(TEST_ENTRIES);

    expect(catalog.findByAddress(' ethereum ', '0xabc123')).toEqual(TEST_ENTRIES[0]);
  });

  it('does not match addresses across different chains', () => {
    const catalog = new InMemoryProtocolCatalog(TEST_ENTRIES);

    expect(catalog.findByAddress('ethereum', '0xdef456')).toBeUndefined();
  });
});

describe('createSeedProtocolCatalog', () => {
  it('exposes the expected bridge protocol seeds', () => {
    const catalog = createSeedProtocolCatalog();

    expect(catalog.list().map((entry) => entry.protocol.id)).toEqual([
      'wormhole',
      'ibc',
      'peggy',
      'gravity',
      'layerzero',
      'hop',
      'across',
      'stargate',
    ]);
  });
});
