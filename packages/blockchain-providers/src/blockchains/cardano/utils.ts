import { getErrorMessage, wrapError } from '@exitbook/core';
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
 * Validate a normalized Cardano address.
 *
 * Accepts:
 * - Shelley mainnet/testnet (addr1..., stake1..., addr_test1..., stake_test1...)
 * - Byron era (Ae2..., DdzFF...)
 * - Extended public keys (128 hex characters)
 *
 * Call normalizeCardanoAddress before this function for Shelley addresses.
 *
 * @param address - The Cardano address to validate (normalized)
 * @returns True if address is valid
 */
export function isValidCardanoAddress(address: string): boolean {
  if (/^[0-9a-fA-F]{128}$/.test(address)) {
    return true;
  }
  return /^(addr1|addr_test1|stake1|stake_test1|Ae2|DdzFF)[A-Za-z0-9]+$/.test(address);
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

// Cardano xpubs are 64 bytes (128 hex characters): public_key (32 bytes) + chain_code (32 bytes)
const CARDANO_XPUB_PATTERN = /^[0-9a-fA-F]{128}$/;

export function isCardanoXpub(address: string): boolean {
  return CARDANO_XPUB_PATTERN.test(address);
}

export function getCardanoAddressEra(address: string): CardanoAddressEra | 'unknown' {
  if (
    address.startsWith('addr1') ||
    address.startsWith('addr_test1') ||
    address.startsWith('stake1') ||
    address.startsWith('stake_test1')
  ) {
    return 'shelley';
  }
  if (address.startsWith('Ae2') || address.startsWith('DdzFF')) {
    return 'byron';
  }
  return 'unknown';
}

/**
 * Derive addresses from a Cardano xpub following CIP-1852.
 *
 * Derives in INTERLEAVED order (external[0], internal[0], external[1], ...) for proper
 * BIP44 gap-limit checking across both chains.
 *
 * @throws Error if xpub format is invalid or derivation fails
 */
export async function deriveCardanoAddressesFromXpub(xpub: string, addressGap = 10): Promise<DerivedCardanoAddress[]> {
  if (!isCardanoXpub(xpub)) {
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

    for (let i = 0; i < addressGap; i++) {
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
 * Initialize a Cardano xpub wallet with address derivation and BIP44 gap scanning.
 * Updates the walletAddress object in-place with derived addresses.
 */
export async function initializeCardanoXpubWallet(
  walletAddress: CardanoWalletAddress,
  providerManager: BlockchainProviderManager,
  addressGap = 10
): Promise<Result<void, Error>> {
  try {
    logger.info(
      `Initializing Cardano xpub wallet - Xpub: ${walletAddress.address.substring(0, 20)}..., Gap: ${addressGap}`
    );

    walletAddress.era = 'shelley'; // Derived addresses are always Shelley-era
    walletAddress.derivationPath = "m/1852'/1815'/0'"; // CIP-1852 account level
    walletAddress.addressGap = addressGap;

    // Use 2x buffer for sparse wallets, minimum 40 addresses per chain
    const scanDepth = Math.max(addressGap * 2, 40);
    const derivedAddressData = await deriveCardanoAddressesFromXpub(walletAddress.address, scanDepth);

    const derivedAddresses = derivedAddressData.map((d) => d.address);
    walletAddress.derivedAddresses = derivedAddresses;

    logger.info(
      `Successfully derived ${derivedAddresses.length} addresses - Xpub: ${walletAddress.address.substring(0, 20)}..., Era: shelley, DerivationPath: ${walletAddress.derivationPath}, TotalAddresses: ${derivedAddresses.length}`
    );

    const scanResult = await performCardanoAddressGapScanning(walletAddress, providerManager);

    if (scanResult.isErr()) {
      return err(scanResult.error);
    }

    return ok();
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    logger.error(
      `Failed to initialize xpub wallet - Error: ${errorMessage}, Xpub: ${walletAddress.address.substring(0, 20)}...`
    );
    return wrapError(error, 'Failed to initialize xpub wallet');
  }
}

/**
 * Perform BIP44-compliant gap scanning to determine the active derived address set.
 * Delegates to the shared gap scanning utility.
 */
export async function performCardanoAddressGapScanning(
  walletAddress: CardanoWalletAddress,
  providerManager: BlockchainProviderManager
): Promise<Result<void, Error>> {
  const allDerived = walletAddress.derivedAddresses ?? [];
  if (allDerived.length === 0) {
    return ok();
  }

  const gapLimit = walletAddress.addressGap ?? 10;

  const result = await performAddressGapScanning(
    { blockchain: 'cardano', derivedAddresses: allDerived, gapLimit },
    providerManager
  );

  if (result.isErr()) return err(result.error);

  walletAddress.derivedAddresses = result.value.addresses;
  return ok();
}
