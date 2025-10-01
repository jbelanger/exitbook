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

export interface UniversalTransaction {
  // Amounts
  amount: Money;
  datetime: string;
  fee?: Money | undefined;
  // Parties (works for both)
  from?: string | undefined; // Sender address OR exchange account
  // Universal fields
  id: string;

  metadata: Record<string, unknown>;
  note?: TransactionNote | undefined; // Scam detection, warnings, classification
  price?: Money | undefined;

  // Metadata
  source: string; // e.g., 'coinbase', 'bitcoin'
  status: TransactionStatus;
  symbol?: string | undefined; // Add symbol for trades

  timestamp: number;
  to?: string | undefined; // Receiver address OR exchange account
  type: TransactionType;
}
