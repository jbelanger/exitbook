// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
// The new processor architecture uses clients instead of providers
import '../avalanche/api/index.js';
import '../bitcoin/api/index.js';
import '../ethereum/api/index.js';
import '../injective/api/index.js';
import '../polkadot/api/index.js';
import '../solana/clients/index.js';
