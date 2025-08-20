import type { EnhancedTransaction, TransactionNote } from '@crypto/core';

// Database schema types for data persistence

export interface StoredTransaction {
  id: string;
  exchange: string;
  type: string;
  timestamp: number;
  datetime?: string;
  symbol?: string;
  amount: number;
  amount_currency?: string;
  side?: string;
  price?: number;
  price_currency?: string;
  cost?: number;
  cost_currency?: string;
  fee_cost?: number;
  fee_currency?: string;
  status?: string;
  from_address?: string;
  to_address?: string;
  wallet_id?: number;
  raw_data: string; // JSON stringified transaction data
  created_at: number;
  hash: string;
  verified?: boolean;
  note_type?: string;
  note_message?: string;
  note_severity?: 'info' | 'warning' | 'error';
  note_metadata?: string; // JSON stringified metadata
}


// Wallet address tracking types
export interface WalletAddress {
  id: number;
  address: string;
  blockchain: string;
  label?: string;
  addressType: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWalletAddressRequest {
  address: string;
  blockchain: string;
  label?: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  notes?: string;
}

export interface UpdateWalletAddressRequest {
  label?: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive?: boolean;
  notes?: string;
}

export interface WalletAddressQuery {
  blockchain?: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive?: boolean;
  search?: string; // Search in address, label, or notes
}

// Enhanced transaction type with wallet address references
export interface TransactionWithAddresses extends EnhancedTransaction {
  fromAddress?: string;
  toAddress?: string;
  fromWalletId?: number;
  toWalletId?: number;
  isInternalTransfer?: boolean;
  fromWallet?: WalletAddress;
  toWallet?: WalletAddress;
}