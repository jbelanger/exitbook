export interface XrpFundFlow {
  isIncoming: boolean;
  isOutgoing: boolean;
  fromAddress: string | undefined;
  toAddress: string | undefined;
  /** Absolute value of the wallet's net balance change (XRP, decimal string) */
  netAmount: string;
  feeAmount: string;
}
