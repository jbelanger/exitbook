// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
// The new processor architecture uses clients instead of providers
import '../avalanche/register-mappers.js';
import '../bitcoin/register-mappers.js';
import '../ethereum/register-mappers.js';
import '../injective/register-mappers.js';
import '../polkadot/register-mappers.js';
import '../solana/register-mappers.js';
