/**
 * Type definitions for XRP transaction processing
 */

/**
 * Fund flow analysis result for XRP transactions
 */
export interface XrpFundFlow {
  /** True if this is an incoming transaction */
  isIncoming: boolean;
  /** True if this is an outgoing transaction */
  isOutgoing: boolean;
  /** Primary from address */
  fromAddress: string | undefined;
  /** Primary to address */
  toAddress: string | undefined;
  /** Net balance change amount for the wallet (in XRP, as decimal string) */
  netAmount: string;
  /** Fee amount (in XRP, as decimal string) */
  feeAmount: string;
}
