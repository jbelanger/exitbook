/**
 * Bitcoin fund flow analysis result
 */
export interface BitcoinFundFlow {
  fromAddress?: string | undefined;
  isIncoming: boolean;
  isOutgoing: boolean;
  netAmount: string;
  toAddress?: string | undefined;
  totalInput: string;
  totalOutput: string;
  walletInput: string;
  walletOutput: string;
}
