import type { Money } from '../value-objects/money.ts';

export type TransactionStatus = 'pending' | 'open' | 'closed' | 'canceled' | 'failed' | 'ok';

// Transaction note interface
export interface TransactionNote {
  message: string;
  metadata?: Record<string, unknown> | undefined;
  severity?: 'info' | 'warning' | 'error' | undefined;
  type: TransactionNoteType;
}

// Lightweight alias for transaction note types coming from other packages.
// Kept as a string for minimal coupling; can be replaced with a concrete union
// or imported type from the import package if that package becomes a dependency.
export type TransactionNoteType = string;

// Operation categories for high-level classification
export type OperationCategory = 'trade' | 'transfer' | 'staking' | 'defi' | 'fee' | 'governance';

// Specific operation types
export type OperationType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'stake'
  | 'unstake'
  | 'reward'
  | 'swap'
  | 'fee'
  | 'batch'
  | 'transfer'
  | 'refund'
  | 'vote'
  | 'proposal';

// Direction of primary movement
export type MovementDirection = 'in' | 'out' | 'neutral';

/**
 * Price information for a movement at transaction time
 * Used for cost basis calculations and accounting
 */
export interface PriceAtTxTime {
  /**
   * Market price of the asset in the accounting currency at transaction time
   * e.g., if asset is BTC and accounting currency is USD, this is BTC/USD price
   */
  price: Money;

  /**
   * Source of the price data (e.g., 'coingecko', 'binance', 'manual')
   */
  source: string;

  /**
   * When the price was fetched/recorded
   */
  fetchedAt: Date;
}

/**
 * Asset movement with optional price information
 */
export interface AssetMovement {
  /**
   * Asset symbol (e.g., 'BTC', 'ETH', 'USD')
   */
  asset: string;

  /**
   * Amount of the asset moved
   */
  amount: Money;

  /**
   * Price of the asset at transaction time (optional, populated by price providers)
   */
  priceAtTxTime?: PriceAtTxTime | undefined;
}

export interface UniversalTransaction {
  // Universal fields
  id: string;
  datetime: string;
  timestamp: number;
  source: string; // e.g., 'coinbase', 'bitcoin'
  status: TransactionStatus;

  // Parties
  from?: string | undefined; // Sender address OR exchange account
  to?: string | undefined; // Receiver address OR exchange account

  // Structured asset movements
  movements: {
    // What user gained
    inflows: AssetMovement[];
    // What user lost
    outflows: AssetMovement[];
    // Primary movement summary
    primary: AssetMovement & {
      direction: MovementDirection;
    };
  };

  // Structured fee breakdown
  fees: {
    network?: Money | undefined; // Gas/blockchain fees
    platform?: Money | undefined; // Exchange/service fees
    total: Money; // Sum of all fees
  };

  // Enhanced operation classification
  operation: {
    category: OperationCategory;
    type: OperationType;
  };

  // Blockchain-specific data (undefined for exchange transactions)
  blockchain?:
    | {
        block_height?: number | undefined;
        is_confirmed: boolean;
        name: string;
        transaction_hash: string;
      }
    | undefined;

  // Optional fields
  note?: TransactionNote | undefined; // Scam detection, warnings, classification
  price?: Money | undefined; // For trades
  metadata?: Record<string, unknown> | undefined; // Minimal provider-specific data
}
