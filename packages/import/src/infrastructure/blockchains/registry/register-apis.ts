// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
// The new processor architecture uses clients instead of providers
import '../avalanche/register-apis.js';
import '../bitcoin/register-apis.js';
import '../ethereum/register-apis.js';
import '../evm/register-apis.js'; // Shared EVM providers (Alchemy, Moralis)
import '../injective/register-apis.js';
import '../polkadot/register-apis.js';
import '../solana/register-apis.js';
