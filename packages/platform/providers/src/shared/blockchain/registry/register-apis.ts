// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
import '../../../blockchains/bitcoin/register-apis.js';
import '../../../blockchains/cardano/register-apis.js';
import '../../../blockchains/cosmos/register-apis.js';
import '../../../blockchains/evm/register-apis.js';
import '../../../blockchains/near/register-apis.js';
import '../../../blockchains/solana/register-apis.js';
import '../../../blockchains/substrate/register-apis.js';
