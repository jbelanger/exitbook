import { getLogger } from '@crypto/shared-logger';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';

import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type {
  AddressInfo,
  AddressType,
  BipStandard,
  BitcoinWalletAddress,
  SmartDetectionResult,
  XpubType,
} from './types.ts';

// Parameter types removed - using discriminated union

const logger = getLogger('BitcoinUtils');

/**
 * Bitcoin HD wallet utilities for xpub management and address derivation
 */
export class BitcoinUtils {
  /**
   * Derive addresses from xpub for wallet service
   */
  static async deriveAddressesFromXpub(
    xpub: string,
    gap: number = 20
  ): Promise<
    Array<{
      address: string;
      derivationPath: string;
      type: string;
    }>
  > {
    const derivedAddresses: Array<{
      address: string;
      derivationPath: string;
      type: string;
    }> = [];

    const xpubType = BitcoinUtils.getAddressType(xpub);
    if (xpubType === 'address') {
      throw new Error('Invalid xpub format');
    }

    try {
      const node = HDKey.fromExtendedKey(xpub);
      const network = bitcoin.networks.bitcoin; // Default to mainnet
      const addressType = xpubType === 'xpub' ? 'legacy' : xpubType === 'ypub' ? 'segwit' : 'bech32';

      const addressGenerator = BitcoinUtils.getAddressGenerator(addressType, network);

      // Derive addresses for receiving chain (0) and change chain (1)
      for (const chain of [0, 1]) {
        for (let index = 0; index < gap; index++) {
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

      return derivedAddresses;
    } catch (error) {
      logger.error(`Failed to derive addresses from xpub - Error: ${error}, Xpub: ${xpub.substring(0, 20) + '...'}`);
      throw error;
    }
  }

  /**
   * Get address generator function for address type
   */
  static getAddressGenerator(type: AddressType, network: bitcoin.Network): (pubkey: Buffer) => string {
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
        throw new Error(`Unsupported address type: ${type}`);
    }
  }

  /**
   * Get xpub type from address string
   */
  static getAddressType(address: string): XpubType {
    if (address.startsWith('xpub')) return 'xpub';
    if (address.startsWith('ypub')) return 'ypub';
    if (address.startsWith('zpub')) return 'zpub';
    return 'address';
  }

  /**
   * Get default derivation path for BIP standard
   */
  static getDefaultDerivationPath(bipStandard: BipStandard): string {
    switch (bipStandard) {
      case 'bip44':
        return "m/44'/0'/0'";
      case 'bip49':
        return "m/49'/0'/0'";
      case 'bip84':
        return "m/84'/0'/0'";
      default:
        throw new Error(`Unsupported BIP standard: ${bipStandard}`);
    }
  }

  /**
   * Initialize an xpub wallet with smart detection and derivation
   */
  static async initializeXpubWallet(
    walletAddress: BitcoinWalletAddress,
    network: bitcoin.Network,
    providerManager: BlockchainProviderManager,
    addressGap: number = 20
  ): Promise<void> {
    try {
      // Smart detection to determine the correct account type
      const { addressFunction, addressType, bipStandard, hdNode } = await this.smartDetectAccountType(
        walletAddress.address,
        network,
        providerManager
      );

      // Update wallet address with detected values
      walletAddress.bipStandard = bipStandard;
      walletAddress.addressType = addressType;
      walletAddress.derivationPath = this.getDefaultDerivationPath(bipStandard);
      walletAddress.addressGap = addressGap;

      // Derive addresses
      const derivedAddresses: string[] = [];

      // Derive both external (0) and change (1) addresses following BIP standard
      // Interleave external and change addresses to ensure both chains are represented early
      // Reduce initial derivation to minimize API calls during gap scanning
      const maxPerChain = Math.min(addressGap, 10); // Limit to 10 per chain initially
      for (let i = 0; i < maxPerChain; i++) {
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
        `Successfully derived ${derivedAddresses.length} addresses using ${bipStandard} - Xpub: ${walletAddress.address.substring(0, 20) + '...'}, AddressType: ${addressType}, BipStandard: ${bipStandard}, DerivationPath: ${walletAddress.derivationPath}, TotalAddresses: ${derivedAddresses.length}`
      );

      // Perform BIP44-compliant intelligent gap scanning
      await this.performAddressGapScanning(walletAddress, providerManager);
    } catch (error) {
      logger.error(
        `Failed to initialize xpub wallet - Error: ${error instanceof Error ? error.message : 'Unknown error'}, Xpub: ${walletAddress.address.substring(0, 20) + '...'}`
      );
      throw error;
    }
  }

  /**
   * Check if address is an extended public key
   */
  static isExtendedPublicKey(address: string): boolean {
    return BitcoinUtils.isXpub(address);
  }

  /**
   * Check if address is an xpub
   */
  static isXpub(address: string): boolean {
    return address.startsWith('xpub') || address.startsWith('ypub') || address.startsWith('zpub');
  }

  /**
   * Perform BIP44-compliant intelligent gap scanning to optimize derived address set
   */
  static async performAddressGapScanning(
    walletAddress: BitcoinWalletAddress,
    providerManager: BlockchainProviderManager
  ): Promise<void> {
    const allDerived = walletAddress.derivedAddresses || [];
    if (allDerived.length === 0) return;

    logger.info(`Performing intelligent gap scan for ${walletAddress.address.substring(0, 20)}...`);

    let lastUsedIndex = -1;
    let consecutiveUnusedCount = 0;
    const GAP_LIMIT = 10; // Reduced gap limit to minimize API calls

    for (let i = 0; i < allDerived.length; i++) {
      const address = allDerived[i];
      if (!address) continue; // Skip invalid addresses

      // Fetch lightweight address info using provider manager
      try {
        const addressInfo = (await providerManager.executeWithFailover('bitcoin', {
          address,
          getCacheKey: params =>
            `bitcoin:address-info:${params.type === 'getAddressInfo' ? params.address : 'unknown'}`,
          type: 'getAddressInfo',
        })) as AddressInfo;

        const hasActivity = addressInfo.txCount > 0;
        if (hasActivity) {
          // Found an active address!
          lastUsedIndex = i;
          consecutiveUnusedCount = 0; // Reset the counter
          logger.debug(`Found activity at index ${i}: ${address} (${addressInfo.txCount} transactions)`);
        } else {
          // Unused address
          consecutiveUnusedCount++;
          logger.debug(`No activity at index ${i}, consecutive unused: ${consecutiveUnusedCount}`);

          // Early exit if we've hit the gap limit
          if (consecutiveUnusedCount >= GAP_LIMIT) {
            logger.info(`Reached gap limit of ${GAP_LIMIT} unused addresses, stopping scan at index ${i}`);
            break;
          }
        }
      } catch (error) {
        // If we can't check the address, treat it as unused
        consecutiveUnusedCount++;
        logger.warn(`Could not check activity for address ${address} - Error: ${error}`);
      }

      // If we've found at least one used address and then hit the gap limit, we can stop.
      if (lastUsedIndex > -1 && consecutiveUnusedCount >= GAP_LIMIT) {
        logger.info(`Gap limit of ${GAP_LIMIT} reached after last used address at index ${lastUsedIndex}.`);
        break;
      }
    }

    let finalAddressCount: number;
    if (lastUsedIndex === -1) {
      // No activity found at all. Just use the first 20 addresses (10 receive, 10 change).
      finalAddressCount = Math.min(allDerived.length, 20);
      logger.info('No activity found. Using default address set size.');
    } else {
      // We found activity. The set should include all addresses up to the last used one, plus the gap limit as a buffer.
      finalAddressCount = Math.min(allDerived.length, lastUsedIndex + GAP_LIMIT + 1);
      logger.info(`Scan complete. Using addresses up to index ${finalAddressCount - 1}.`);
    }

    // Optimize the derived addresses list in place.
    walletAddress.derivedAddresses = allDerived.slice(0, finalAddressCount);

    logger.info(`Optimized address set: ${walletAddress.derivedAddresses.length} addresses (was ${allDerived.length})`);
  }

  /**
   * Smart detection to determine the correct account type from xpub
   */
  static async smartDetectAccountType(
    xpub: string,
    network: bitcoin.Network,
    providerManager: BlockchainProviderManager
  ): Promise<SmartDetectionResult> {
    logger.info('Intelligently detecting account type from xpub...');

    // Handle unambiguous cases
    if (xpub.startsWith('zpub')) {
      logger.info('Detected zpub. Using BIP84 (Native SegWit).');
      return {
        addressFunction: this.getAddressGenerator('bech32', network),
        addressType: 'bech32',
        bipStandard: 'bip84',
        hdNode: HDKey.fromExtendedKey(xpub),
      };
    }

    if (xpub.startsWith('ypub')) {
      logger.info('Detected ypub. Using BIP49 (Nested SegWit).');
      return {
        addressFunction: this.getAddressGenerator('segwit', network),
        addressType: 'segwit',
        bipStandard: 'bip49',
        hdNode: HDKey.fromExtendedKey(xpub),
      };
    }

    // Complex case: xpub could be BIP44 (Legacy) or BIP84 (Ledger-style Native SegWit)
    if (xpub.startsWith('xpub')) {
      logger.info('Detected xpub. Attempting to determine account type...');

      // Test BIP44 (Legacy)
      const legacyHdNode = HDKey.fromExtendedKey(xpub);
      const legacyAddressGen = this.getAddressGenerator('legacy', network);
      const firstLegacyChild = legacyHdNode.deriveChild(0).deriveChild(0);

      if (firstLegacyChild.publicKey) {
        const firstLegacyAddress = legacyAddressGen(Buffer.from(firstLegacyChild.publicKey));

        logger.debug(`Checking Legacy address for activity: ${firstLegacyAddress}`);

        try {
          const addressInfo = (await providerManager.executeWithFailover('bitcoin', {
            address: firstLegacyAddress,
            type: 'getAddressInfo',
          })) as AddressInfo;
          const hasActivity = addressInfo.txCount > 0;
          if (hasActivity) {
            logger.info('Found activity on Legacy path (BIP44). Proceeding.');
            return {
              addressFunction: legacyAddressGen,
              addressType: 'legacy',
              bipStandard: 'bip44',
              hdNode: legacyHdNode,
            };
          }
        } catch (error) {
          logger.debug('No activity found on Legacy path');
        }
      }

      // Test BIP84 (Ledger-style Native SegWit)
      logger.info('No activity found on Legacy path. Checking for Native SegWit (Ledger-style)...');

      const segwitHdNode = HDKey.fromExtendedKey(xpub);
      const segwitAddressGen = this.getAddressGenerator('bech32', network);
      const firstSegwitChild = segwitHdNode.deriveChild(0).deriveChild(0);

      if (firstSegwitChild.publicKey) {
        const firstSegwitAddress = segwitAddressGen(Buffer.from(firstSegwitChild.publicKey));

        logger.debug(`Checking Native SegWit address for activity: ${firstSegwitAddress}`);

        try {
          const addressInfo = (await providerManager.executeWithFailover('bitcoin', {
            address: firstSegwitAddress,
            type: 'getAddressInfo',
          })) as AddressInfo;
          const hasActivity = addressInfo.txCount > 0;
          if (hasActivity) {
            logger.info('Found activity on Native SegWit path (BIP84). Proceeding.');
            return {
              addressFunction: segwitAddressGen,
              addressType: 'bech32',
              bipStandard: 'bip84',
              hdNode: segwitHdNode,
            };
          }
        } catch (error) {
          logger.debug('No activity found on Native SegWit path');
        }
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

    throw new Error('Unsupported extended public key format.');
  }
}
