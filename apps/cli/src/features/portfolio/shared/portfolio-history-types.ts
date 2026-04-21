export interface PortfolioTransactionItem {
  id: number;
  datetime: string;
  operationGroup: 'other' | 'staking' | 'trade' | 'transfer';
  operationLabel: string;
  platformKey: string;
  assetAmount: string;
  assetDirection: 'in' | 'out';
  fiatValue?: string | undefined;
  transferPeer?: string | undefined;
  transferDirection?: 'to' | 'from' | undefined;
  inflows: { amount: string; assetSymbol: string }[];
  outflows: { amount: string; assetSymbol: string }[];
  fees: { amount: string; assetSymbol: string }[];
}
