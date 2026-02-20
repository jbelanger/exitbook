import { getErrorMessage } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { RawBalanceData } from '../../core/index.js';
import type { BlockchainProviderManager } from '../../core/manager/provider-manager.js';
import { performAddressGapScanning } from '../../core/utils/gap-scan-utils.js';

import type { CardanoAddressEra, CardanoWalletAddress, DerivedCardanoAddress } from './types.js';

const logger = getLogger('CardanoUtils');

/**
 * Normalize Cardano address based on address era and encoding.
 *
 * Normalization rules:
 * - Extended public keys (128 hex chars): Case-sensitive, return as-is
 * - Shelley Bech32 (addr1*, stake1*): Lowercase (Bech32 must be lowercase)
 * - Byron Base58 (Ae2*, DdzFF*): Case-sensitive, return as-is
 *
 * @param address - Cardano address to normalize
 * @returns Normalized address
 */
export function normalizeCardanoAddress(address: string): string {
  // Handle extended public keys (128 hex characters)
  if (/^[0-9a-fA-F]{128}$/.test(address)) {
    return address;
  }

  // Handle Shelley-era Bech32 addresses (must be lowercase)
  if (
    address.toLowerCase().startsWith('addr1') ||
    address.toLowerCase().startsWith('addr_test1') ||
    address.toLowerCase().startsWith('stake1') ||
    address.toLowerCase().startsWith('stake_test1')
  ) {
    return address.toLowerCase();
  }

  // Byron-era addresses (Base58) - case-sensitive, return as-is
  return address;
}

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
   * Derivation follows CIP-1852 standard (based on BIP44):
   * - Path: m/1852'/1815'/account'/role/index
   * - The xpub is at account level (hardened derivation already complete)
   * - Only role and index use soft derivation
   * - role=0: External/receiving addresses
   * - role=1: Internal/change addresses
   *
   * BIP44 gap limit applies to consecutive unused addresses in INTERLEAVED order:
   * - Derives in order: 0/0, 1/0, 0/1, 1/1, 0/2, 1/2, ...
   * - Gap limit checks happen during scanning in this interleaved sequence
   *
   * @param xpub - The account-level extended public key (128 hex characters)
   * @param addressGap - Address gap limit for BIP44 scanning (default: 10)
   * @returns Promise resolving to array of derived addresses with metadata
   *
   * @throws Error if xpub format is invalid or derivation fails
   *
   * @example
   * ```typescript
   * const addresses = await CardanoUtils.deriveAddressesFromXpub(xpub, 10);
   * // Returns in interleaved order: [
   * //   { address: 'addr1...', derivationPath: '0/0', role: 'external' },
   * //   { address: 'addr1...', derivationPath: '1/0', role: 'internal' },
   * //   { address: 'addr1...', derivationPath: '0/1', role: 'external' },
   * //   { address: 'addr1...', derivationPath: '1/1', role: 'internal' },
   * //   ...
   * // ]
   * ```
   */
  static async deriveAddressesFromXpub(xpub: string, addressGap = 10): Promise<DerivedCardanoAddress[]> {
    if (!CardanoUtils.isExtendedPublicKey(xpub)) {
      throw new Error('Invalid Cardano extended public key format');
    }

    try {
      // Dynamically import Cardano SDK modules to avoid loading at startup
      const { Bip32PublicKey } = await import('@cardano-sdk/crypto');
      const { Cardano } = await import('@cardano-sdk/core');

      // Parse the extended public key from hex
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- hard to import Bip32PublicKeyHex
      const accountPublicKey = Bip32PublicKey.fromHex(xpub as any);

      const derivedAddresses: DerivedCardanoAddress[] = [];

      // Derive the stake key at CIP-1852 path: account'/2/0
      // This single stake key is used for all addresses in the account
      const stakeKey = accountPublicKey.derive([2, 0]);
      const stakeCredential = stakeKey.toRawKey().hash().hex() as string;

      // Pre-derive role keys for both external (0) and internal (1)
      const externalRoleKey = accountPublicKey.derive([0]);
      const internalRoleKey = accountPublicKey.derive([1]);

      // Derive addresses in INTERLEAVED order: external[0], internal[0], external[1], internal[1], ...
      // This ensures proper gap limit checking across both chains per BIP44 standard
      // Derive exactly addressGap addresses per chain (external + internal)
      for (let i = 0; i < addressGap; i++) {
        // Derive external address (role=0)
        const externalAddressKey = externalRoleKey.derive([i]);
        const externalPaymentCredential = externalAddressKey.toRawKey().hash().hex() as string;
        /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any -- Cardano SDK credential types */
        const externalBaseAddress = Cardano.BaseAddress.fromCredentials(
          Cardano.NetworkId.Mainnet,
          { hash: externalPaymentCredential as any, type: Cardano.CredentialType.KeyHash },
          { hash: stakeCredential as any, type: Cardano.CredentialType.KeyHash }
        );
        /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any -- Cardano SDK credential types */
        derivedAddresses.push({
          address: externalBaseAddress.toAddress().toBech32() as string,
          derivationPath: `0/${i}`,
          role: 'external',
        });

        // Derive internal address (role=1)
        const internalAddressKey = internalRoleKey.derive([i]);
        const internalPaymentCredential = internalAddressKey.toRawKey().hash().hex() as string;
        /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any -- Cardano SDK credential types */
        const internalBaseAddress = Cardano.BaseAddress.fromCredentials(
          Cardano.NetworkId.Mainnet,
          { hash: internalPaymentCredential as any, type: Cardano.CredentialType.KeyHash },
          { hash: stakeCredential as any, type: Cardano.CredentialType.KeyHash }
        );
        /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any -- Cardano SDK credential types */
        derivedAddresses.push({
          address: internalBaseAddress.toAddress().toBech32() as string,
          derivationPath: `1/${i}`,
          role: 'internal',
        });
      }

      logger.debug(
        `Derived ${derivedAddresses.length} addresses (interleaved) from xpub - Xpub: ${xpub.substring(0, 20)}..., Gap: ${addressGap}`
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

      // Derive addresses from xpub with buffer for gap scanning
      // Use 2x buffer for sparse wallets, minimum 40 addresses per chain
      const scanDepth = Math.max(addressGap * 2, 40);
      const derivedAddressData = await CardanoUtils.deriveAddressesFromXpub(walletAddress.address, scanDepth);

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
   * Perform BIP44-compliant gap scanning to determine derived address set.
   * Delegates to the shared gap scanning utility.
   */
  static async performAddressGapScanning(
    walletAddress: CardanoWalletAddress,
    providerManager: BlockchainProviderManager
  ): Promise<Result<void, Error>> {
    const allDerived = walletAddress.derivedAddresses || [];
    if (allDerived.length === 0) {
      return ok();
    }

    const gapLimit = walletAddress.addressGap || 10;

    const result = await performAddressGapScanning(
      { blockchain: 'cardano', derivedAddresses: allDerived, gapLimit },
      providerManager
    );

    if (result.isErr()) return err(result.error);

    walletAddress.derivedAddresses = result.value.addresses;
    return ok();
  }
}
