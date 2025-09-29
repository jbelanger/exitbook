// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
// The new processor architecture uses clients instead of providers
import '../avalanche/register-apis.ts';
import '../bitcoin/register-apis.ts';
import '../ethereum/register-apis.ts';
import '../injective/register-apis.ts';
import '../polkadot/register-apis.ts';
import '../solana/register-apis.ts';
