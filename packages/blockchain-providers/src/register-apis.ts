// Import all blockchain clients to trigger their registration
// This must be imported before using the ProviderRegistry
import './blockchains/bitcoin/register-apis.ts';
import './blockchains/cardano/register-apis.ts';
import './blockchains/cosmos/register-apis.ts';
import './blockchains/evm/register-apis.ts';
import './blockchains/near/register-apis.ts';
import './blockchains/solana/register-apis.ts';
import './blockchains/substrate/register-apis.ts';
