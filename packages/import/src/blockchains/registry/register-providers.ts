// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
// The new processor architecture uses clients instead of providers
import '../avalanche/api/index.ts';
import '../bitcoin/api/index.ts';
import '../ethereum/api/index.ts';
import '../injective/api/index.ts';
import '../polkadot/api/index.ts';
import '../solana/clients/index.ts';
