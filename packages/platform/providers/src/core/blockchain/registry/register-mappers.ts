// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
import '../../../blockchain/bitcoin/register-mappers.js';
import '../../../blockchain/evm/register-mappers.js';
import '../../../blockchain/cosmos/register-mappers.js';
import '../../../blockchain/substrate/register-mappers.js';
import '../../../blockchain/solana/register-mappers.js';
