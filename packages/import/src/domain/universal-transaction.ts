import type { Money } from '@exitbook/core';

export type TransactionType =
  | 'trade'
  | 'deposit'
  | 'withdrawal'
  | 'order'
  | 'ledger'
  | 'transfer'
  | 'fee'
  | 'staking_deposit' // Staking funds (bonding)
  | 'staking_withdrawal' // Unstaking funds (unbonding/withdraw)
  | 'staking_reward' // Staking rewards received
  | 'governance_deposit' // Governance deposits (proposals, votes)
  | 'governance_refund' // Governance refunds
  | 'internal_transfer' // Self-to-self transfers
  | 'proxy' // Proxy transactions
  | 'multisig' // Multisig transactions
  | 'utility_batch' // Batch transactions
  | 'unknown';

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
    inflows: {
      amount: Money;
      asset: string;
    }[];
    // What user lost
    outflows: {
      amount: Money;
      asset: string;
    }[];
    // Primary movement summary
    primary: {
      amount: Money; // Positive = gained, negative = lost
      asset: string;
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
