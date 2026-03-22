import {
  ProviderError,
  createAssetReviewProviderSupport,
  createBlockchainProviderRuntime,
  findLatestTokenMetadataRefreshAt,
  listBlockchainProviders,
  loadBlockchainExplorerConfig,
  loadBlockchainProviderHealthStats,
  openProviderBenchmarkSession,
  type BlockchainProviderDescriptor,
  type IBlockchainProviderManager,
} from '@exitbook/blockchain-providers';
import { describe, expect, expectTypeOf, it } from 'vitest';

const BLOCKCHAIN_SUBPATH_EXPORTS = {
  '@exitbook/blockchain-providers/bitcoin': [
    'BITCOIN_CHAINS',
    'BitcoinAddressSchema',
    'BitcoinTransactionSchema',
    'canonicalizeBitcoinAddress',
    'deriveBitcoinAddressesFromXpub',
    'generateBitcoinTransactionEventId',
    'getAddressGenerator',
    'getBitcoinAddressType',
    'getBitcoinChainConfig',
    'getDefaultDerivationPath',
    'initializeBitcoinXpubWallet',
    'isBitcoinXpub',
    'isExtendedPublicKey',
    'performBitcoinAddressGapScanning',
    'satoshisToBtcString',
    'smartDetectBitcoinAccountType',
  ],
  '@exitbook/blockchain-providers/cardano': [
    'CARDANO_CHAINS',
    'CardanoAddressSchema',
    'CardanoTransactionSchema',
    'createRawBalanceData',
    'deriveCardanoAddressesFromXpub',
    'getCardanoAddressEra',
    'getCardanoChainConfig',
    'initializeCardanoXpubWallet',
    'isCardanoXpub',
    'isValidCardanoAddress',
    'lovelaceToAda',
    'normalizeCardanoAddress',
    'performCardanoAddressGapScanning',
  ],
  '@exitbook/blockchain-providers/cosmos': [
    'COSMOS_CHAINS',
    'CosmosAddressSchema',
    'CosmosTransactionSchema',
    'convertBech32Prefix',
    'deriveBech32AddressVariants',
    'formatDenom',
    'generatePeggyEventRootId',
    'getAllCosmosChainNames',
    'getCommonCosmosPrefixes',
    'getCosmosChainConfig',
    'isCosmosChainSupported',
    'isSameBech32Address',
    'isTransactionRelevant',
    'parseCosmosMessageType',
    'validateBech32Address',
  ],
  '@exitbook/blockchain-providers/evm': [
    'EVM_CHAINS',
    'EvmAddressSchema',
    'EvmTransactionSchema',
    'extractMethodId',
    'generateBeaconWithdrawalEventId',
    'getEvmChainConfig',
    'getTransactionTypeFromFunctionName',
    'isValidEvmAddress',
    'normalizeEvmAddress',
  ],
  '@exitbook/blockchain-providers/near': [
    'NEAR_CHAINS',
    'NearActionTypeSchema',
    'NearBalanceChangeCauseSchema',
    'NearBalanceChangeSchema',
    'NearReceiptActionSchema',
    'NearReceiptSchema',
    'NearStreamEventSchema',
    'NearStreamTypeSchema',
    'NearTokenTransferSchema',
    'NearTransactionSchema',
    'formatNearAccountId',
    'getNearChainConfig',
    'isValidNearAccountId',
    'nearToYoctoNear',
    'yoctoNearToNear',
    'yoctoNearToNearString',
  ],
  '@exitbook/blockchain-providers/solana': [
    'SOLANA_CHAINS',
    'SolanaTransactionSchema',
    'deduplicateTransactionsBySignature',
    'extractAccountChanges',
    'extractAccountChangesFromSolscan',
    'extractTokenChanges',
    'generateSolanaTransactionEventId',
    'getSolanaChainConfig',
    'isValidSolanaAddress',
    'lamportsToSol',
    'parseSolanaTransactionType',
    'solToLamports',
  ],
  '@exitbook/blockchain-providers/substrate': [
    'SUBSTRATE_CHAINS',
    'SubstrateAddressSchema',
    'SubstrateEventDataSchema',
    'SubstrateTransactionSchema',
    'derivePolkadotAddressVariants',
    'encodeSS58Address',
    'getSubstrateChainConfig',
    'isSamePolkadotAddress',
    'isValidSS58Address',
    'normalizeSubstrateAccountIdHex',
    'parseSubstrateTransactionType',
    'trySubstrateAddressToAccountIdHex',
  ],
  '@exitbook/blockchain-providers/theta': [
    'THETA_CHAINS',
    'THETA_GAS_ASSET_SYMBOL',
    'THETA_NATIVE_DECIMALS',
    'THETA_PRIMARY_ASSET_SYMBOL',
    'formatThetaAmount',
    'getThetaChainConfig',
    'isThetaTokenTransfer',
    'parseCommaFormattedNumber',
    'selectThetaCurrency',
  ],
  '@exitbook/blockchain-providers/xrp': [
    'XRP_CHAINS',
    'XrpAddressSchema',
    'XrpAmountSchema',
    'XrpBalanceChangeSchema',
    'XrpDropsAmountSchema',
    'XrpIssuedCurrencyAmountSchema',
    'XrpTransactionSchema',
    'dropsToXrpDecimalString',
    'getXrpChainConfig',
    'isValidXrpAddress',
    'normalizeXrpAddress',
    'rippleTimeToUnix',
    'toIssuedCurrencyRawBalance',
    'transformXrpBalance',
    'unixToRippleTime',
    'xrpToDrops',
  ],
} as const;

const BLOCKCHAIN_SUBPATH_EXPORT_ENTRIES = Object.entries(BLOCKCHAIN_SUBPATH_EXPORTS) as readonly [
  keyof typeof BLOCKCHAIN_SUBPATH_EXPORTS,
  readonly string[],
][];

describe('published package exports', () => {
  it('exposes the curated root facade', async () => {
    const moduleExports = await import('@exitbook/blockchain-providers');

    expect(Object.keys(moduleExports).sort()).toEqual(
      [
        'ProviderError',
        'createAssetReviewProviderSupport',
        'createBlockchainProviderRuntime',
        'findLatestTokenMetadataRefreshAt',
        'listBlockchainProviders',
        'loadBlockchainExplorerConfig',
        'loadBlockchainProviderHealthStats',
        'openProviderBenchmarkSession',
      ].sort()
    );

    expect(typeof createAssetReviewProviderSupport).toBe('function');
    expect(typeof createBlockchainProviderRuntime).toBe('function');
    expect(typeof findLatestTokenMetadataRefreshAt).toBe('function');
    expect(typeof listBlockchainProviders).toBe('function');
    expect(typeof loadBlockchainExplorerConfig).toBe('function');
    expect(typeof loadBlockchainProviderHealthStats).toBe('function');
    expect(typeof openProviderBenchmarkSession).toBe('function');
    expect(ProviderError).toBeDefined();

    expectTypeOf<BlockchainProviderDescriptor>().toMatchTypeOf<{
      blockchain: string;
      displayName: string;
      name: string;
    }>();
    expectTypeOf<IBlockchainProviderManager>().toMatchTypeOf<{
      getProviders: (blockchain: string) => unknown;
    }>();
  });

  for (const [subpath, expectedExports] of BLOCKCHAIN_SUBPATH_EXPORT_ENTRIES) {
    it(`exposes a curated ${subpath.split('/').pop()} subpath`, async () => {
      const moduleExports = (await import(subpath)) as unknown as Record<string, unknown>;
      expect(Object.keys(moduleExports).sort()).toEqual([...expectedExports].sort());
    });
  }
});
