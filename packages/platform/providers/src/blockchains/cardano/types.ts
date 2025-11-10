/**
 * Cardano HD wallet types for extended public key management
 *
 * Supports CIP-1852 (Cardano Improvement Proposal 1852) hierarchical deterministic wallets.
 * Derivation path: m/1852'/1815'/account'/role/index
 * - 1852': Purpose (hardened) - CIP-1852 standard
 * - 1815': Coin type (hardened) - Cardano (1815 = year Ada Lovelace was born)
 * - account': Account index (hardened)
 * - role: Chain type (0 = external/receiving, 1 = internal/change) - soft derivation
 * - index: Address index - soft derivation
 *
 * Extended public keys (xpub) are exported at the account level (m/1852'/1815'/0'),
 * allowing derivation of both external and change addresses without exposing private keys.
 */

/**
 * Type of Cardano address
 * - xpub: CIP-1852 extended public key (account-level, enables address derivation)
 * - address: Regular Cardano address (Byron or Shelley)
 */
export type CardanoAddressType = 'xpub' | 'address';

/**
 * Cardano address era/format
 * - byron: Byron-era addresses (base58 encoding, starts with Ae2 or DdzFF)
 * - shelley: Shelley-era addresses (Bech32 encoding, starts with addr1 or stake1)
 */
export type CardanoAddressEra = 'byron' | 'shelley';

/**
 * CIP-1852 chain roles for address derivation
 * - external: Receiving addresses (role = 0), shown to others for receiving funds
 * - internal: Change addresses (role = 1), used internally for transaction change
 */
export type CardanoChainRole = 'external' | 'internal';

/**
 * Interface for Cardano wallet addresses supporting both xpub and regular addresses
 */
export interface CardanoWalletAddress {
  /**
   * Original user-provided address
   * Can be either:
   * - Extended public key (xpub) for HD wallet derivation
   * - Regular Cardano address (Byron or Shelley)
   */
  address: string;

  /**
   * Address gap limit used for derivation
   * Only applicable when address is an xpub
   * Follows BIP44 gap limit standard (typically 20, reduced to 10 for API efficiency)
   */
  addressGap?: number | undefined;

  /**
   * Type of address (xpub or regular address)
   */
  type: CardanoAddressType;

  /**
   * Address era/format (Byron or Shelley)
   * Detected automatically from address format
   */
  era?: CardanoAddressEra | undefined;

  /**
   * Derivation path used for xpub address derivation
   * Format: m/1852'/1815'/0' (account-level)
   * Only applicable when type is 'xpub'
   */
  derivationPath?: string | undefined;

  /**
   * Array of derived addresses from xpub
   * Contains both external (receiving) and internal (change) addresses
   * Only applicable when type is 'xpub'
   */
  derivedAddresses?: string[] | undefined;
}

/**
 * Metadata for a derived Cardano address
 */
export interface DerivedCardanoAddress {
  /**
   * The derived Bech32 address (addr1...)
   */
  address: string;

  /**
   * Derivation path relative to account xpub
   * Format: role/index (e.g., "0/0", "1/5")
   */
  derivationPath: string;

  /**
   * Chain role (external or internal)
   */
  role: CardanoChainRole;
}
