// Import all blockchain providers to trigger their registration
// This must be imported before using the ProviderRegistry

// Bitcoin Providers
import "../bitcoin/providers/BlockCypherProvider.ts";
import "../bitcoin/providers/BlockstreamProvider.ts";
import "../bitcoin/providers/MempoolSpaceProvider.ts";

// Ethereum Providers
import "../ethereum/providers/AlchemyProvider.ts";
import "../ethereum/providers/EtherscanProvider.ts";
import "../ethereum/providers/MoralisProvider.ts";

// Solana Providers
import "../solana/providers/HeliusProvider.ts";
import "../solana/providers/SolanaRPCProvider.ts";
import "../solana/providers/SolscanProvider.ts";

// Avalanche Providers
import "../avalanche/providers/SnowtraceProvider.ts";

// Injective Providers
import "../injective/providers/InjectiveExplorerProvider.ts";
import "../injective/providers/InjectiveLCDProvider.ts";

// Polkadot/Substrate Providers
import "../polkadot/providers/SubstrateProvider.ts";
