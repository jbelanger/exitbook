import * as bitcoin from 'bitcoinjs-lib';

/**
 * Network parameters for Bitcoin-like blockchains.
 * Used for xpub derivation and address generation.
 *
 * These define the cryptographic parameters used by each blockchain for:
 * - BIP32 extended key derivation (xpub/xprv)
 * - Address format encoding (pubKeyHash, scriptHash)
 * - Private key encoding (WIF format)
 */
export const BITCOIN_NETWORKS: Record<string, bitcoin.Network> = {
  bitcoin: bitcoin.networks.bitcoin,

  dogecoin: {
    bech32: 'doge',
    bip32: {
      private: 0x02fac398, // dgpv
      public: 0x02facafd, // dgub
    },
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    pubKeyHash: 0x1e, // D prefix for addresses
    scriptHash: 0x16, // 9 or A prefix
    wif: 0x9e,
  },

  litecoin: {
    bech32: 'ltc',
    bip32: {
      private: 0x019d9cfe, // Ltpv
      public: 0x019da462, // Ltub
    },
    messagePrefix: '\x19Litecoin Signed Message:\n',
    pubKeyHash: 0x30, // L prefix for addresses
    scriptHash: 0x32, // M prefix (current standard)
    wif: 0xb0,
  },

  // Bitcoin Cash uses the same network parameters as Bitcoin for xpub derivation
  // (BCH uses different address encoding format but same BIP32 parameters)
  'bitcoin-cash': bitcoin.networks.bitcoin,
};

/**
 * Get network parameters for a given blockchain.
 *
 * @param chainName - The blockchain name (e.g., 'bitcoin', 'dogecoin', 'litecoin', 'bitcoin-cash')
 * @returns bitcoinjs-lib Network object containing cryptographic parameters
 * @throws Error if the chain is not supported
 *
 * @example
 * ```typescript
 * const network = getNetworkForChain('dogecoin');
 * const node = bip32.fromBase58(xpub, network);
 * ```
 */
export function getNetworkForChain(chainName: string): bitcoin.Network {
  const network = BITCOIN_NETWORKS[chainName];
  if (!network) {
    throw new Error(`No network definition found for chain: ${chainName}`);
  }
  return network;
}
