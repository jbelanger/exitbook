// Transaction-related types
export interface UniversalTransaction {
  id: string;
  source: string;
  type: string;
  symbol: string;
  amount: number;
  timestamp: string;
  address?: string;
  network?: string;
  side?: 'buy' | 'sell';
  price?: number;
  quoteCurrency?: string;
  fee?: {
    amount: number;
    currency: string;
  };
  blockchainHash?: string;
  blockHeight?: number;
  status?: string;
  gasUsed?: number;
  gasPrice?: string;
  exchangeOrderId?: string;
  exchangeTradeId?: string;
  metadata?: Record<string, any>;
}