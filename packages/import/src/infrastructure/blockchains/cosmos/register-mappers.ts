/**
 * Auto-registration of Cosmos SDK transaction mappers
 *
 * This file imports all Cosmos provider transaction mappers to trigger their decorators.
 * The @RegisterTransactionMapper decorator registers each mapper with the processor registry.
 *
 * Current mappers:
 * - Injective Explorer mapper (Injective-specific raw data � CosmosTransaction)
 *
 * Future mappers:
 * - Mintscan mapper (multi-chain support)
 * - Cosmos Directory mapper (universal RPC/REST data)
 */

// Injective Explorer mapper
import './providers/injective-explorer/injective-explorer.mapper.js';

// Future: Add more multi-chain mappers here
// import './providers/mintscan/mintscan.mapper.js';
// import './providers/cosmos-directory/cosmos-directory.mapper.js';
