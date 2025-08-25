// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
// The new processor architecture uses clients instead of providers
import '../avalanche/clients/index.ts';
import '../bitcoin/clients/index.ts';
import '../ethereum/clients/index.ts';
import '../injective/clients/index.ts';
import '../polkadot/clients/index.ts';
import '../solana/clients/index.ts';
