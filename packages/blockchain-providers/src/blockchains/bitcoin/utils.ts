import { getErrorMessage, parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { HDKey } from '@scure/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainProviderManager } from '../../core/provider-manager.js';

import { getNetworkForChain } from './network-registry.js';
import type { AddressType, BipStandard, BitcoinWalletAddress, SmartDetectionResult, XpubType } from './types.js';

const logger = getLogger('BitcoinUtils');

/**
 * Convert satoshis to BTC as a string
 */
export function satoshisToBtcString(satoshis: number): string {
  return parseDecimal(satoshis.toString()).div(100000000).toFixed();
}

/**
 * Bitcoin HD wallet utilities for xpub management and address derivation
 */
export class BitcoinUtils {
  /**
   * Derive addresses from xpub for wallet service
   */
  static deriveAddressesFromXpub(
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
        throw new Error(`Unsupported address type: ${String(type)}`);
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
        throw new Error(`Unsupported BIP standard: ${String(bipStandard)}`);
    }
  }

  /**
   * Initialize an xpub wallet with smart detection and derivation
   */
  static async initializeXpubWallet(
    walletAddress: BitcoinWalletAddress,
    blockchain: string,
    providerManager: BlockchainProviderManager,
    addressGap = 20
  ): Promise<Result<void, Error>> {
    try {
      // Smart detection to determine the correct account type
      const { addressFunction, addressType, bipStandard, hdNode } = await this.smartDetectAccountType(
        walletAddress.address,
        blockchain,
        providerManager
      );

      // Update wallet address with detected values
      walletAddress.bipStandard = bipStandard;
      walletAddress.addressType = addressType;
      walletAddress.derivationPath = this.getDefaultDerivationPath(bipStandard);
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
      const scanResult = await this.performAddressGapScanning(walletAddress, blockchain, providerManager, addressGap);
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
   * Perform BIP44-compliant gap scanning to determine derived address set.
   *
   * Creates child accounts for ALL derived addresses up to the gap limit after the last used address.
   * This ensures that fresh change addresses are tracked, enabling accurate multi-address fund flow analysis.
   *
   * Algorithm:
   * 1. Scan addresses in interleaved order (already arranged by derivation)
   * 2. Track highest index with activity
   * 3. Stop scanning after finding gap limit consecutive unused addresses
   * 4. Include ALL addresses up to highestUsedIndex + gapLimit
   *
   * @param gapLimit - Number of consecutive unused addresses before stopping (BIP44 standard)
   */
  static async performAddressGapScanning(
    walletAddress: BitcoinWalletAddress,
    blockchain: string,
    providerManager: BlockchainProviderManager,
    gapLimit = 20
  ): Promise<Result<void, Error>> {
    const allDerived = walletAddress.derivedAddresses || [];
    if (allDerived.length === 0) return ok();

    logger.info(`Performing gap scan for ${walletAddress.address.substring(0, 20)}... (gap limit: ${gapLimit})`);

    let consecutiveUnusedCount = 0;
    let highestUsedIndex = -1;
    let errorCount = 0;
    const MAX_ERRORS = 3; // Fail if we can't check multiple addresses

    for (let i = 0; i < allDerived.length; i++) {
      const address = allDerived[i];
      if (!address) continue; // Skip invalid addresses

      // Check if address has transactions using provider manager
      const result = await providerManager.executeWithFailoverOnce(blockchain, {
        address,
        getCacheKey: (params) => `bitcoin:has-txs:${(params as { address: string }).address}`,
        type: 'hasAddressTransactions',
      });

      if (result.isErr()) {
        errorCount++;
        logger.warn(`Could not check activity for address ${address} - Error: ${result.error.message}`);

        // If we hit too many consecutive API errors, fail the scan
        if (errorCount >= MAX_ERRORS) {
          return err(new Error(`Failed to scan addresses: ${result.error.message}`));
        }

        consecutiveUnusedCount++;
        continue;
      }

      // Reset error count on successful API call
      errorCount = 0;

      const hasActivity = result.value.data as boolean;
      if (hasActivity) {
        // Found an active address - track highest index
        highestUsedIndex = i;
        consecutiveUnusedCount = 0; // Reset the counter
        logger.debug(`Found activity at index ${i}: ${address}`);
      } else {
        // Unused address
        consecutiveUnusedCount++;
        logger.debug(`No activity at index ${i}, consecutive unused: ${consecutiveUnusedCount}`);

        // Stop scanning beyond the gap limit
        if (consecutiveUnusedCount >= gapLimit) {
          logger.info(`Reached gap limit of ${gapLimit} unused addresses, stopping scan at index ${i}`);
          break;
        }
      }
    }

    // Include ALL addresses up to highestUsedIndex + gapLimit
    // This ensures fresh change addresses are tracked for accurate fund flow analysis
    const lastIndex = Math.min(
      highestUsedIndex >= 0 ? highestUsedIndex + gapLimit : gapLimit - 1,
      allDerived.length - 1
    );
    walletAddress.derivedAddresses = allDerived.slice(0, lastIndex + 1);

    const addressesWithActivity = highestUsedIndex + 1;
    const addressesForFutureUse = walletAddress.derivedAddresses.length - addressesWithActivity;

    logger.info(
      `Derived address set: ${walletAddress.derivedAddresses.length} addresses ` +
        `(${addressesWithActivity} with activity, ${addressesForFutureUse} for future use)`
    );
    return ok();
  }

  /**
   * Smart detection to determine the correct account type from xpub
   */
  static async smartDetectAccountType(
    xpub: string,
    blockchain: string,
    providerManager: BlockchainProviderManager
  ): Promise<SmartDetectionResult> {
    const network = getNetworkForChain(blockchain);
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

        const legacyResult = await providerManager.executeWithFailoverOnce(blockchain, {
          address: firstLegacyAddress,
          type: 'hasAddressTransactions',
        });

        if (legacyResult.isErr()) {
          // API error - cannot determine activity, propagate error
          throw legacyResult.error;
        }

        const hasLegacyActivity = legacyResult.value.data as boolean;
        if (hasLegacyActivity) {
          logger.info('Found activity on Legacy path (BIP44). Proceeding.');
          return {
            addressFunction: legacyAddressGen,
            addressType: 'legacy',
            bipStandard: 'bip44',
            hdNode: legacyHdNode,
          };
        }

        logger.debug('No activity found on Legacy path');
      }

      // Test BIP84 (Ledger-style Native SegWit)
      logger.info('No activity found on Legacy path. Checking for Native SegWit (Ledger-style)...');

      const segwitHdNode = HDKey.fromExtendedKey(xpub);
      const segwitAddressGen = this.getAddressGenerator('bech32', network);
      const firstSegwitChild = segwitHdNode.deriveChild(0).deriveChild(0);

      if (firstSegwitChild.publicKey) {
        const firstSegwitAddress = segwitAddressGen(Buffer.from(firstSegwitChild.publicKey));

        logger.debug(`Checking Native SegWit address for activity: ${firstSegwitAddress}`);

        const segwitResult = await providerManager.executeWithFailoverOnce(blockchain, {
          address: firstSegwitAddress,
          type: 'hasAddressTransactions',
        });

        if (segwitResult.isErr()) {
          // API error - cannot determine activity, propagate error
          throw segwitResult.error;
        }

        const hasSegwitActivity = segwitResult.value.data as boolean;
        if (hasSegwitActivity) {
          logger.info('Found activity on Native SegWit path (BIP84). Proceeding.');
          return {
            addressFunction: segwitAddressGen,
            addressType: 'bech32',
            bipStandard: 'bip84',
            hdNode: segwitHdNode,
          };
        }

        logger.debug('No activity found on Native SegWit path');
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
