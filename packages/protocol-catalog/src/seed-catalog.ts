import { InMemoryProtocolCatalog, type IProtocolCatalog, type ProtocolCatalogEntry } from './catalog.js';

// Phase 1 seed. Bridge protocols only; deployments intentionally empty until
// real address data is reviewed against existing `bridge_transfer` diagnostics.
// Treat the addresses arrays as placeholders rather than authoritative lookups.
const SEED_ENTRIES: readonly ProtocolCatalogEntry[] = [
  { protocol: { id: 'wormhole' }, displayName: 'Wormhole' },
  { protocol: { id: 'ibc' }, displayName: 'IBC' },
  { protocol: { id: 'peggy' }, displayName: 'Peggy Bridge', aliases: ['injective_peggy'] },
  { protocol: { id: 'cctp' }, displayName: 'Circle CCTP', aliases: ['circle_cctp'] },
  {
    protocol: { id: 'op-stack-standard-bridge' },
    displayName: 'OP Stack Standard Bridge',
    aliases: ['op_stack_standard_bridge', 'optimism_standard_bridge', 'base_standard_bridge'],
  },
  { protocol: { id: 'arbitrum-bridge' }, displayName: 'Arbitrum Bridge', aliases: ['arbitrum_bridge'] },
  {
    protocol: { id: 'polygon-zkevm-bridge' },
    displayName: 'Polygon zkEVM Bridge',
    aliases: ['polygon_zkevm_bridge', 'polygon_bridge'],
  },
  { protocol: { id: 'gravity' }, displayName: 'Gravity Bridge' },
  { protocol: { id: 'layerzero' }, displayName: 'LayerZero' },
  { protocol: { id: 'hop' }, displayName: 'Hop Protocol' },
  { protocol: { id: 'across' }, displayName: 'Across' },
  { protocol: { id: 'stargate' }, displayName: 'Stargate' },
];

export function createSeedProtocolCatalog(): IProtocolCatalog {
  return new InMemoryProtocolCatalog(SEED_ENTRIES);
}
