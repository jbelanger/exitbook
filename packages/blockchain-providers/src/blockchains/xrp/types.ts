/**
 * Type definitions for XRP Ledger blockchain provider
 */

/**
 * XRP Ledger transaction types
 * See: https://xrpl.org/transaction-types.html
 */
export type XrpTransactionType =
  | 'Payment'
  | 'OfferCreate'
  | 'OfferCancel'
  | 'TrustSet'
  | 'AccountSet'
  | 'SetRegularKey'
  | 'SignerListSet'
  | 'EscrowCreate'
  | 'EscrowFinish'
  | 'EscrowCancel'
  | 'PaymentChannelCreate'
  | 'PaymentChannelFund'
  | 'PaymentChannelClaim'
  | 'CheckCreate'
  | 'CheckCash'
  | 'CheckCancel'
  | 'DepositPreauth'
  | 'NFTokenMint'
  | 'NFTokenBurn'
  | 'NFTokenCreateOffer'
  | 'NFTokenCancelOffer'
  | 'NFTokenAcceptOffer';

/**
 * Transaction result codes
 * See: https://xrpl.org/transaction-results.html
 */
export type XrpTransactionResult =
  | 'tesSUCCESS'
  | 'tecCLAIM'
  | 'tecPATH_PARTIAL'
  | 'tecUNFUNDED_PAYMENT'
  | 'tecNO_DST_INSUF_XRP'
  | (string & {}); // Allow other result codes while preserving autocomplete

/**
 * Ledger entry types
 */
export type XrpLedgerEntryType =
  | 'AccountRoot'
  | 'DirectoryNode'
  | 'RippleState'
  | 'Offer'
  | 'NFTokenPage'
  | 'PayChannel'
  | 'Check'
  | 'Escrow'
  | 'SignerList'
  | 'Ticket'
  | 'DepositPreauth';
