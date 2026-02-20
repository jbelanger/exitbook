import { getErrorMessage, parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { err, ok, type Result } from 'neverthrow';

import { generateUniqueTransactionEventId } from '../../core/index.js';
import type { BlockchainProviderManager } from '../../core/manager/provider-manager.js';
import { performAddressGapScanning } from '../../core/utils/gap-scan-utils.js';

import { getNetworkForChain } from './network-registry.js';
import type { AddressType, BipStandard, BitcoinWalletAddress, SmartDetectionResult, XpubType } from './types.js';

const logger = getLogger('BitcoinUtils');

/**
 * Version bytes for BIP32 extended keys (SLIP-132)
 * Used for parsing xpub/ypub/zpub keys with @scure/bip32
 */
const BIP32_VERSIONS = {
  /** BIP44 (Legacy P2PKH) */
  xpub: {
    private: 0x0488ade4,
    public: 0x0488b21e,
  },
  /** BIP49 (Nested SegWit P2WPKH-in-P2SH) */
  ypub: {
    private: 0x049d7878,
    public: 0x049d7cb2,
  },
  /** BIP84 (Native SegWit P2WPKH) */
  zpub: {
    private: 0x04b2430c,
    public: 0x04b24746,
  },
} as const;

/**
 * Deterministic event identity for Bitcoin-like chains.
 *
 * Important: raw storage dedup is keyed by `(account_id, event_id)` and the raw layer
 * is append-only (no upserts). This means `eventId` MUST NOT depend on fields that
 * can change between imports (e.g., "pending vs confirmed" timestamp).
 *
 * For Bitcoin-like chains, we currently treat "one normalized transaction" as the
 * event granularity, so the canonical discriminant is the on-chain txid plus the
 * chain's native currency.
 */
export function generateBitcoinTransactionEventId(params: { currency: string; txid: string }): string {
  return generateUniqueTransactionEventId({
    amount: '0',
    currency: params.currency,
    from: '',
    id: params.txid,
    timestamp: 0,
    traceId: 'utxo-tx',
    type: 'transfer',
  });
}

/**
 * Normalize Bitcoin address based on address type.
 *
 * Normalization rules:
 * - xpub/ypub/zpub: Case-sensitive, return as-is
 * - Bech32 (bc1/ltc1): Lowercase (case-insensitive encoding)
 * - CashAddr (bitcoincash:): Lowercase (case-insensitive encoding)
 * - Legacy (Base58): Case-sensitive, return as-is
 *
 * @param address - Bitcoin address to normalize
 * @returns Normalized address
 */
export function normalizeBitcoinAddress(address: string): string {
  // Handle xpub/ypub/zpub formats (case-sensitive)
  if (/^[xyz]pub/i.test(address)) {
    return address;
  }

  // Handle Bech32 addresses (lowercase them - Bech32 is case-insensitive)
  if (
    address.toLowerCase().startsWith('bc1') ||
    address.toLowerCase().startsWith('ltc1') ||
    address.toLowerCase().startsWith('doge1')
  ) {
    return address.toLowerCase();
  }

  // Handle CashAddr format for Bitcoin Cash (case-insensitive)
  if (address.toLowerCase().startsWith('bitcoincash:')) {
    return address.toLowerCase();
  }

  // Handle CashAddr short format (without bitcoincash: prefix)
  const lowerAddr = address.toLowerCase();
  if (lowerAddr.startsWith('q') || lowerAddr.startsWith('p')) {
    // Could be CashAddr - normalize to lowercase
    return lowerAddr;
  }

  // Legacy addresses (Base58 encoding) - case-sensitive, return as-is
  return address;
}

/**
 * Convert satoshis to BTC as a string
 */
export function satoshisToBtcString(satoshis: number): string {
  return parseDecimal(satoshis.toString()).div(100000000).toFixed();
}

/**
 * Derive addresses from xpub for wallet service
 */
export function deriveBitcoinAddressesFromXpub(
  xpub: string,
  addressGapLimit = 20
): Promise<
  {
    address: string;
    derivationPath: string;
    type: string;
  }[]
> {
  const derivedAddresses: {
    address: string;
    derivationPath: string;
    type: string;
  }[] = [];

  const xpubType = getBitcoinAddressType(xpub);
  if (xpubType === 'address') {
    throw new Error('Invalid xpub format');
  }

  try {
    const versions = BIP32_VERSIONS[xpubType];
    const node = HDKey.fromExtendedKey(xpub, versions);
    const network = bitcoin.networks.bitcoin; // Default to mainnet

    let addressType: AddressType;
    if (xpubType === 'xpub') {
      addressType = 'legacy';
    } else if (xpubType === 'ypub') {
      addressType = 'segwit';
    } else {
      addressType = 'bech32';
    }

    const addressGenerator = getAddressGenerator(addressType, network);

    // Derive addresses for receiving chain (0) and change chain (1)
    for (const chain of [0, 1]) {
      for (let index = 0; index < addressGapLimit; index++) {
        const childNode = node.deriveChild(chain).deriveChild(index);
        const publicKeyBuffer = Buffer.from(childNode.publicKey!);
        const address = addressGenerator(publicKeyBuffer);

        derivedAddresses.push({
          address,
          derivationPath: `m/${chain}/${index}`,
          type: addressType,
        });
      }
    }

    return Promise.resolve(derivedAddresses);
  } catch (error) {
    logger.error(
      `Failed to derive addresses from xpub - Error: ${String(error)}, Xpub: ${xpub.substring(0, 20) + '...'}`
    );
    throw error;
  }
}

/**
 * Get address generator function for address type
 */
export function getAddressGenerator(type: AddressType, network: bitcoin.Network): (pubkey: Buffer) => string {
  switch (type) {
    case 'legacy':
      return (pubkey: Buffer) => {
        const payment = bitcoin.payments.p2pkh({ network, pubkey });
        return payment.address!;
      };
    case 'segwit':
      return (pubkey: Buffer) => {
        const p2wpkh = bitcoin.payments.p2wpkh({ network, pubkey });
        const payment = bitcoin.payments.p2sh({ network, redeem: p2wpkh });
        return payment.address!;
      };
    case 'bech32':
      return (pubkey: Buffer) => {
        const payment = bitcoin.payments.p2wpkh({ network, pubkey });
        return payment.address!;
      };
    default:
      throw new Error(`Unsupported address type: ${String(type)}`);
  }
}

/**
 * Get xpub type from address string
 */
export function getBitcoinAddressType(address: string): XpubType {
  if (address.startsWith('xpub')) return 'xpub';
  if (address.startsWith('ypub')) return 'ypub';
  if (address.startsWith('zpub')) return 'zpub';
  return 'address';
}

/**
 * Get default derivation path for BIP standard
 */
export function getDefaultDerivationPath(bipStandard: BipStandard): string {
  switch (bipStandard) {
    case 'bip44':
      return "m/44'/0'/0'";
    case 'bip49':
      return "m/49'/0'/0'";
    case 'bip84':
      return "m/84'/0'/0'";
    default:
      throw new Error(`Unsupported BIP standard: ${String(bipStandard)}`);
  }
}

/**
 * Initialize an xpub wallet with smart detection and derivation
 */
export async function initializeBitcoinXpubWallet(
  walletAddress: BitcoinWalletAddress,
  blockchain: string,
  providerManager: BlockchainProviderManager,
  addressGap = 20
): Promise<Result<void, Error>> {
  try {
    // Smart detection to determine the correct account type
    const { addressFunction, addressType, bipStandard, hdNode } = await smartDetectBitcoinAccountType(
      walletAddress.address,
      blockchain,
      providerManager
    );

    // Update wallet address with detected values
    walletAddress.bipStandard = bipStandard;
    walletAddress.addressType = addressType;
    walletAddress.derivationPath = getDefaultDerivationPath(bipStandard);
    walletAddress.addressGap = addressGap;

    // Derive addresses
    const derivedAddresses: string[] = [];

    // Derive both external (0) and change (1) addresses following BIP44 standard
    // BIP44: gap limit applies to consecutive unused in the INTERLEAVED sequence
    // Derive in order: external[0], change[0], external[1], change[1], external[2], change[2], ...
    // This ensures proper gap limit checking across both chains
    const maxInterleavedDepth = Math.max(addressGap * 2, 40); // 2x buffer for sparse wallets, min 40 per chain
    for (let i = 0; i < maxInterleavedDepth; i++) {
      for (const change of [0, 1]) {
        const childKey = hdNode.deriveChild(change).deriveChild(i);

        if (!childKey.publicKey) {
          logger.warn(`Failed to derive public key for ${change}/${i}`);
          continue;
        }

        const address = addressFunction(Buffer.from(childKey.publicKey));
        derivedAddresses.push(address);
      }
    }

    walletAddress.derivedAddresses = derivedAddresses;

    logger.info(
      `Derived ${derivedAddresses.length} addresses for gap scanning using ${bipStandard} - Xpub: ${walletAddress.address.substring(0, 20) + '...'}, AddressType: ${addressType}, BipStandard: ${bipStandard}, DerivationPath: ${walletAddress.derivationPath}`
    );

    // Perform BIP44-compliant gap scanning with user's gap limit
    const scanResult = await performBitcoinAddressGapScanning(walletAddress, blockchain, providerManager, addressGap);
    if (scanResult.isErr()) {
      return err(scanResult.error);
    }

    return ok();
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    logger.error(
      `Failed to initialize xpub wallet - Error: ${errorMessage}, Xpub: ${walletAddress.address.substring(0, 20) + '...'}`
    );
    return err(error instanceof Error ? error : new Error(errorMessage));
  }
}

/**
 * Check if address is an extended public key
 */
export function isExtendedPublicKey(address: string): boolean {
  return isBitcoinXpub(address);
}

/**
 * Check if address is an xpub
 */
export function isBitcoinXpub(address: string): boolean {
  return address.startsWith('xpub') || address.startsWith('ypub') || address.startsWith('zpub');
}

/**
 * Perform BIP44-compliant gap scanning to determine derived address set.
 * Delegates to the shared gap scanning utility.
 *
 * @param gapLimit - Number of consecutive unused addresses before stopping (BIP44 standard)
 */
export async function performBitcoinAddressGapScanning(
  walletAddress: BitcoinWalletAddress,
  blockchain: string,
  providerManager: BlockchainProviderManager,
  gapLimit = 20
): Promise<Result<void, Error>> {
  const allDerived = walletAddress.derivedAddresses || [];
  if (allDerived.length === 0) return ok();

  const result = await performAddressGapScanning(
    { blockchain, derivedAddresses: allDerived, gapLimit },
    providerManager
  );

  if (result.isErr()) return err(result.error);

  walletAddress.derivedAddresses = result.value.addresses;
  return ok();
}

/**
 * Smart detection to determine the correct account type from xpub
 */
export async function smartDetectBitcoinAccountType(
  xpub: string,
  blockchain: string,
  providerManager: BlockchainProviderManager
): Promise<SmartDetectionResult> {
  const network = getNetworkForChain(blockchain);
  logger.info('Intelligently detecting account type from xpub...');

  // 1. Handle unambiguous cases (zpub, ypub)
  if (xpub.startsWith('zpub')) {
    logger.info('Detected zpub. Using BIP84 (Native SegWit).');
    return {
      addressFunction: getAddressGenerator('bech32', network),
      addressType: 'bech32',
      bipStandard: 'bip84',
      hdNode: HDKey.fromExtendedKey(xpub, BIP32_VERSIONS.zpub),
    };
  }

  if (xpub.startsWith('ypub')) {
    logger.info('Detected ypub. Using BIP49 (Nested SegWit).');
    return {
      addressFunction: getAddressGenerator('segwit', network),
      addressType: 'segwit',
      bipStandard: 'bip49',
      hdNode: HDKey.fromExtendedKey(xpub, BIP32_VERSIONS.ypub),
    };
  }

  // 2. Handle ambiguous case: xpub
  if (xpub.startsWith('xpub')) {
    return detectXpubAccountType(xpub, blockchain, providerManager, network);
  }

  throw new Error('Unsupported extended public key format.');
}

/**
 * Detect account type for 'xpub' prefix (BIP44 vs BIP84)
 */
async function detectXpubAccountType(
  xpub: string,
  blockchain: string,
  providerManager: BlockchainProviderManager,
  network: bitcoin.Network
): Promise<SmartDetectionResult> {
  logger.info('Detected xpub. Attempting to determine account type...');

  // Test BIP44 (Legacy)
  const legacyHdNode = HDKey.fromExtendedKey(xpub, BIP32_VERSIONS.xpub);
  const legacyAddressGen = getAddressGenerator('legacy', network);

  if (await checkActivityForHdNode(legacyHdNode, legacyAddressGen, blockchain, providerManager)) {
    logger.info('Found activity on Legacy path (BIP44). Proceeding.');
    return {
      addressFunction: legacyAddressGen,
      addressType: 'legacy',
      bipStandard: 'bip44',
      hdNode: legacyHdNode,
    };
  }

  // Test BIP84 (Ledger-style Native SegWit)
  logger.info('No activity found on Legacy path. Checking for Native SegWit (Ledger-style)...');

  const segwitHdNode = HDKey.fromExtendedKey(xpub, BIP32_VERSIONS.xpub);
  const segwitAddressGen = getAddressGenerator('bech32', network);

  if (await checkActivityForHdNode(segwitHdNode, segwitAddressGen, blockchain, providerManager)) {
    logger.info('Found activity on Native SegWit path (BIP84). Proceeding.');
    return {
      addressFunction: segwitAddressGen,
      addressType: 'bech32',
      bipStandard: 'bip84',
      hdNode: segwitHdNode,
    };
  }

  // Fallback to Legacy
  logger.info('No activity found on any path. Defaulting to BIP44 (Legacy).');
  return {
    addressFunction: legacyAddressGen,
    addressType: 'legacy',
    bipStandard: 'bip44',
    hdNode: legacyHdNode,
  };
}

/**
 * Check for activity on the first address of an HD node
 */
async function checkActivityForHdNode(
  hdNode: HDKey,
  addressGen: (pubkey: Buffer) => string,
  blockchain: string,
  providerManager: BlockchainProviderManager
): Promise<boolean> {
  const firstChild = hdNode.deriveChild(0).deriveChild(0);

  if (!firstChild.publicKey) {
    return false;
  }

  const address = addressGen(Buffer.from(firstChild.publicKey));
  logger.debug(`Checking address for activity: ${address}`);

  const result = await providerManager.executeWithFailoverOnce(blockchain, {
    address,
    type: 'hasAddressTransactions',
  });

  if (result.isErr()) {
    // API error - cannot determine activity, propagate error
    throw result.error;
  }

  return result.value.data as boolean;
}
