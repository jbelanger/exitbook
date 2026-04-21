import { InMemoryProtocolCatalog, type IProtocolCatalog, type ProtocolCatalogEntry } from './catalog.js';

// Phase 1 seed. Bridge protocols only; deployments intentionally empty until
// real address data is reviewed against existing `bridge_transfer` diagnostics.
// Treat the addresses arrays as placeholders rather than authoritative lookups.
const SEED_ENTRIES: readonly ProtocolCatalogEntry[] = [
  { protocol: { id: 'wormhole' }, displayName: 'Wormhole' },
  { protocol: { id: 'ibc' }, displayName: 'IBC' },
  { protocol: { id: 'peggy' }, displayName: 'Peggy Bridge', aliases: ['injective_peggy'] },
  { protocol: { id: 'gravity' }, displayName: 'Gravity Bridge' },
  { protocol: { id: 'layerzero' }, displayName: 'LayerZero' },
  { protocol: { id: 'hop' }, displayName: 'Hop Protocol' },
  { protocol: { id: 'across' }, displayName: 'Across' },
  { protocol: { id: 'stargate' }, displayName: 'Stargate' },
];

export function createSeedProtocolCatalog(): IProtocolCatalog {
  return new InMemoryProtocolCatalog(SEED_ENTRIES);
}
