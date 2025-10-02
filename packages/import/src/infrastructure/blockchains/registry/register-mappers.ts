// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
import '../bitcoin/register-mappers.js';
import '../evm/register-mappers.js';
import '../cosmos/register-mappers.js';
import '../substrate/register-mappers.js';
import '../solana/register-mappers.js';
