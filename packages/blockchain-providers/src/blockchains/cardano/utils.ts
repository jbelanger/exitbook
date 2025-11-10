import { getErrorMessage } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { RawBalanceData } from '../../shared/blockchain/index.ts';
import type { BlockchainProviderManager } from '../../shared/blockchain/provider-manager.js';

import type { CardanoAddressEra, CardanoWalletAddress, DerivedCardanoAddress } from './types.js';

const logger = getLogger('CardanoUtils');

/**
 * Convert lovelace (smallest unit) to ADA
 * 1 ADA = 1,000,000 lovelace
 */
export function lovelaceToAda(lovelace: string | number): string {
  const lovelaceNum = typeof lovelace === 'string' ? parseFloat(lovelace) : lovelace;
  return (lovelaceNum / 1000000).toString();
}

/**
 * Create RawBalanceData from lovelace balance
 */
export function createRawBalanceData(lovelace: string, ada: string): RawBalanceData {
  return {
    decimals: 6,
    decimalAmount: ada,
    rawAmount: lovelace,
    symbol: 'ADA',
  };
}

/**
 * Cardano HD wallet utilities for extended public key management and address derivation
 *
 * Implements CIP-1852 (Cardano Improvement Proposal 1852) hierarchical deterministic wallets.
 * Extended public keys are exported at account level (m/1852'/1815'/0'), allowing derivation
 * of both external (receiving) and internal (change) addresses without exposing private keys.
 */
export class CardanoUtils {
  /**
   * Check if the provided address is a Cardano extended public key (xpub)
   *
   * Cardano extended public keys are typically 128 hex characters (64 bytes):
   * - 32 bytes: Public key
   * - 32 bytes: Chain code
   *
   * @param address - The address string to check
   * @returns True if the address is an extended public key, false otherwise
   *
   * @example
   * ```typescript
   * const isXpub = CardanoUtils.isExtendedPublicKey('a0b1c2d3...');
   * ```
   */
  static isExtendedPublicKey(address: string): boolean {
    // Cardano xpubs are 64 bytes (128 hex characters)
    // Format: public_key (32 bytes) + chain_code (32 bytes)
    const hexPattern = /^[0-9a-fA-F]{128}$/;
    return hexPattern.test(address);
  }

  /**
   * Detect the era/format of a Cardano address
   *
   * @param address - The Cardano address to analyze
   * @returns The detected era: 'byron' for legacy addresses, 'shelley' for modern addresses, 'unknown' if invalid
   *
   * Address formats:
   * - Byron (legacy): Base58 encoding, starts with 'Ae2' or 'DdzFF'
   * - Shelley (modern): Bech32 encoding, starts with 'addr1' or 'stake1'
   *
   * @example
   * ```typescript
   * const era = CardanoUtils.getAddressEra('addr1qxy...');
   * // Returns: 'shelley'
   *
   * const byronEra = CardanoUtils.getAddressEra('DdzFFzCqrht...');
   * // Returns: 'byron'
   * ```
   */
  static getAddressEra(address: string): CardanoAddressEra | 'unknown' {
    // Shelley-era addresses (Bech32 format)
    if (
      address.startsWith('addr1') ||
      address.startsWith('addr_test1') ||
      address.startsWith('stake1') ||
      address.startsWith('stake_test1')
    ) {
      return 'shelley';
    }

    // Byron-era addresses (Base58 format)
    if (address.startsWith('Ae2') || address.startsWith('DdzFF')) {
      return 'byron';
    }

    return 'unknown';
  }

  /**
   * Derive addresses from a Cardano extended public key (xpub) following CIP-1852
   *
   * Derivation follows CIP-1852 standard:
   * - Path: m/1852'/1815'/account'/role/index
   * - The xpub is at account level (hardened derivation already complete)
   * - Only role and index use soft derivation
   * - role=0: External/receiving addresses
   * - role=1: Internal/change addresses
   *
   * @param xpub - The account-level extended public key (128 hex characters)
   * @param gap - Number of addresses to derive per chain (default: 10)
   * @returns Promise resolving to array of derived addresses with metadata
   *
   * @throws Error if xpub format is invalid or derivation fails
   *
   * @example
   * ```typescript
   * const addresses = await CardanoUtils.deriveAddressesFromXpub(xpub, 10);
   * // Returns: [
   * //   { address: 'addr1...', derivationPath: '0/0', role: 'external' },
   * //   { address: 'addr1...', derivationPath: '1/0', role: 'internal' },
   * //   ...
   * // ]
   * ```
   */
  static async deriveAddressesFromXpub(xpub: string, gap = 10): Promise<DerivedCardanoAddress[]> {
    if (!CardanoUtils.isExtendedPublicKey(xpub)) {
      throw new Error('Invalid Cardano extended public key format');
    }

    try {
      // Dynamically import Cardano SDK modules to avoid loading at startup
      const { Bip32PublicKey } = await import('@cardano-sdk/crypto');
      const { Cardano } = await import('@cardano-sdk/core');

      // Parse the extended public key from hex
      const accountPublicKey = Bip32PublicKey.fromHex(xpub);

      const derivedAddresses: DerivedCardanoAddress[] = [];

      // Derive the stake key at CIP-1852 path: account'/2/0
      // This single stake key is used for all addresses in the account
      const stakeKey = accountPublicKey.derive([2, 0]);
      const stakeCredential = stakeKey.toRawKey().hash().hex() as string;

      // Derive addresses for both external (role=0) and internal/change (role=1)
      for (const roleIndex of [0, 1]) {
        const role: 'external' | 'internal' = roleIndex === 0 ? 'external' : 'internal';

        // Derive the role-level key (soft derivation)
        // Note: derive() expects an array of indices, not a single index
        const roleKey = accountPublicKey.derive([roleIndex]);

        for (let addressIndex = 0; addressIndex < gap; addressIndex++) {
          // Derive the address-level key (soft derivation)
          const addressKey = roleKey.derive([addressIndex]);

          // Generate Shelley-era mainnet payment address following CIP-1852
          const paymentCredential = addressKey.toRawKey().hash().hex() as string;

          // Create a base address with proper payment and stake credentials
          // Payment key is unique per address, stake key is shared across all addresses in account
          const baseAddress = Cardano.BaseAddress.fromCredentials(
            Cardano.NetworkId.Mainnet,
            { hash: paymentCredential, type: Cardano.CredentialType.KeyHash }, // Payment credential (unique)
            { hash: stakeCredential, type: Cardano.CredentialType.KeyHash } // Stake credential (shared at 2/0)
          );

          const bech32Address = baseAddress.toAddress().toBech32() as string;
          const derivationPath = `${roleIndex}/${addressIndex}`;

          derivedAddresses.push({
            address: bech32Address,
            derivationPath,
            role,
          });
        }
      }

      logger.debug(
        `Derived ${derivedAddresses.length} addresses from xpub - Xpub: ${xpub.substring(0, 20)}..., Gap: ${gap}`
      );

      return derivedAddresses;
    } catch (error) {
      logger.error(`Failed to derive addresses from xpub - Error: ${String(error)}, Xpub: ${xpub.substring(0, 20)}...`);
      throw error;
    }
  }

  /**
   * Initialize a Cardano xpub wallet with address derivation and gap scanning
   *
   * This method:
   * 1. Derives addresses from the extended public key
   * 2. Performs BIP44-compliant gap scanning to detect used addresses
   * 3. Optimizes the address set based on actual usage
   * 4. Updates the walletAddress object in-place with derived addresses
   *
   * @param walletAddress - The wallet address object to initialize (modified in-place)
   * @param providerManager - Provider manager for blockchain queries
   * @param addressGap - Address gap limit (default: 10, reduced for API efficiency)
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * const walletAddress: CardanoWalletAddress = {
   *   address: xpub,
   *   type: 'xpub',
   * };
   *
   * const result = await CardanoUtils.initializeXpubWallet(
   *   walletAddress,
   *   providerManager,
   *   10
   * );
   *
   * if (result.isOk()) {
   *   console.log('Derived addresses:', walletAddress.derivedAddresses);
   * }
   * ```
   */
  static async initializeXpubWallet(
    walletAddress: CardanoWalletAddress,
    providerManager: BlockchainProviderManager,
    addressGap = 10
  ): Promise<Result<void, Error>> {
    try {
      logger.info(
        `Initializing Cardano xpub wallet - Xpub: ${walletAddress.address.substring(0, 20)}..., Gap: ${addressGap}`
      );

      // Set metadata
      walletAddress.era = 'shelley'; // Derived addresses are always Shelley-era
      walletAddress.derivationPath = "m/1852'/1815'/0'"; // CIP-1852 account level
      walletAddress.addressGap = addressGap;

      // Derive addresses from xpub
      const derivedAddressData = await CardanoUtils.deriveAddressesFromXpub(walletAddress.address, addressGap);

      // Extract just the address strings for storage
      const derivedAddresses = derivedAddressData.map((d) => d.address);
      walletAddress.derivedAddresses = derivedAddresses;

      logger.info(
        `Successfully derived ${derivedAddresses.length} addresses - Xpub: ${walletAddress.address.substring(0, 20)}..., Era: shelley, DerivationPath: ${walletAddress.derivationPath}, TotalAddresses: ${derivedAddresses.length}`
      );

      // Perform BIP44-compliant intelligent gap scanning
      const scanResult = await CardanoUtils.performAddressGapScanning(walletAddress, providerManager);

      if (scanResult.isErr()) {
        return err(scanResult.error);
      }

      return ok();
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Unknown error');
      logger.error(
        `Failed to initialize xpub wallet - Error: ${errorMessage}, Xpub: ${walletAddress.address.substring(0, 20)}...`
      );
      return err(error instanceof Error ? error : new Error(errorMessage));
    }
  }

  /**
   * Perform BIP44-compliant intelligent gap scanning to optimize derived address set
   *
   * Scans derived addresses to detect which ones have transaction history,
   * then optimizes the address set to include only necessary addresses
   * based on the gap limit.
   *
   * Algorithm:
   * 1. Check each address for transaction activity
   * 2. Track the last address with activity
   * 3. Stop scanning after finding gap limit consecutive unused addresses
   * 4. Trim address set to last used address + gap limit buffer
   *
   * @param walletAddress - The wallet address object with derived addresses
   * @param providerManager - Provider manager for blockchain queries
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * const result = await CardanoUtils.performAddressGapScanning(
   *   walletAddress,
   *   providerManager
   * );
   * ```
   */
  static async performAddressGapScanning(
    walletAddress: CardanoWalletAddress,
    providerManager: BlockchainProviderManager
  ): Promise<Result<void, Error>> {
    const allDerived = walletAddress.derivedAddresses || [];
    if (allDerived.length === 0) {
      return ok();
    }

    logger.info(`Performing intelligent gap scan for ${walletAddress.address.substring(0, 20)}...`);

    let lastUsedIndex = -1;
    let consecutiveUnusedCount = 0;
    const GAP_LIMIT = 10; // Reduced gap limit to minimize API calls
    let errorCount = 0;
    const MAX_ERRORS = 3; // Fail if we can't check multiple addresses

    for (let i = 0; i < allDerived.length; i++) {
      const address = allDerived[i];
      if (!address) continue; // Skip invalid addresses

      // Check if address has transactions using provider manager
      const result = await providerManager.executeWithFailover('cardano', {
        address,
        getCacheKey: (params) => `cardano:has-txs:${(params as { address: string }).address}`,
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
        // Found an active address!
        lastUsedIndex = i;
        consecutiveUnusedCount = 0; // Reset the counter
        logger.debug(`Found activity at index ${i}: ${address}`);
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

      // If we've found at least one used address and then hit the gap limit, we can stop
      if (lastUsedIndex > -1 && consecutiveUnusedCount >= GAP_LIMIT) {
        logger.info(`Gap limit of ${GAP_LIMIT} reached after last used address at index ${lastUsedIndex}.`);
        break;
      }
    }

    let finalAddressCount: number;
    if (lastUsedIndex === -1) {
      // No activity found at all. Just use the first 20 addresses (10 external, 10 internal).
      finalAddressCount = Math.min(allDerived.length, 20);
      logger.info('No activity found. Using default address set size.');
    } else {
      // We found activity. The set should include all addresses up to the last used one, plus the gap limit as a buffer.
      finalAddressCount = Math.min(allDerived.length, lastUsedIndex + GAP_LIMIT + 1);
      logger.info(`Scan complete. Using addresses up to index ${finalAddressCount - 1}.`);
    }

    // Optimize the derived addresses list in place
    walletAddress.derivedAddresses = allDerived.slice(0, finalAddressCount);

    logger.info(`Optimized address set: ${walletAddress.derivedAddresses.length} addresses (was ${allDerived.length})`);

    return ok();
  }
}
