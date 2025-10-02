// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
import '../bitcoin/register-apis.js';
import '../evm/register-apis.js';
import '../cosmos/register-apis.js';
import '../substrate/register-apis.js';
import '../solana/register-apis.js';
