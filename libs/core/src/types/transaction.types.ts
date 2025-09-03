// Transaction-related types
export interface UniversalTransaction {
  address?: string;
  amount: number;
  blockchainHash?: string;
  blockHeight?: number;
  exchangeOrderId?: string;
  exchangeTradeId?: string;
  fee?: {
    amount: number;
    currency: string;
  };
  gasPrice?: string;
  gasUsed?: number;
  id: string;
  metadata?: Record<string, unknown>;
  network?: string;
  price?: number;
  quoteCurrency?: string;
  side?: 'buy' | 'sell';
  source: string;
  status?: string;
  symbol: string;
  timestamp: string;
  type: string;
}
