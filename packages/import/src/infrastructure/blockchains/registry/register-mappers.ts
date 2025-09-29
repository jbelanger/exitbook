// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
// The new processor architecture uses clients instead of providers
import '../avalanche/register-mappers.ts';
import '../bitcoin/register-mappers.ts';
import '../ethereum/register-mappers.ts';
import '../injective/register-mappers.ts';
import '../polkadot/register-mappers.ts';
import '../solana/register-mappers.ts';
