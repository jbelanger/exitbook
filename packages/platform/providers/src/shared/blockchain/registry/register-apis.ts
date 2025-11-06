// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
import '../../../blockchain/bitcoin/register-apis.js';
import '../../../blockchain/cardano/register-apis.js';
import '../../../blockchain/cosmos/register-apis.js';
import '../../../blockchain/evm/register-apis.js';
import '../../../blockchain/solana/register-apis.js';
import '../../../blockchain/substrate/register-apis.js';
