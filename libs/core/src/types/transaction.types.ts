import { Money } from '../value-objects/money/money.vo';

// Transaction-related types
export interface UniversalTransaction {
  address?: string;
  amount: Money;
  blockchainHash?: string;
  blockHeight?: number;
  exchangeOrderId?: string;
  exchangeTradeId?: string;
  fee?: Money;
  gasPrice?: string;
  gasUsed?: number;
  id: string;
  metadata?: Record<string, unknown>;
  network?: string;
  price?: Money;
  quoteCurrency?: string;
  side?: 'buy' | 'sell';
  source: string;
  status?: string;
  symbol: string;
  timestamp: string;
  type: string;
}
