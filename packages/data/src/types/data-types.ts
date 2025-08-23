import type { EnhancedTransaction } from "@crypto/core";

// Database schema types for data persistence

export interface StoredTransaction {
  id: string;
  exchange: string;
  type: string;
  timestamp: number;
  datetime?: string;
  symbol?: string;
  amount: string;
  amount_currency?: string;
  side?: string;
  price?: string;
  price_currency?: string;
  cost?: string;
  cost_currency?: string;
  fee_cost?: string;
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
  note_severity?: "info" | "warning" | "error";
  note_metadata?: string; // JSON stringified metadata
}

// Wallet address tracking types
export interface WalletAddress {
  id: number;
  address: string;
  blockchain: string;
  label?: string | undefined;
  addressType: "personal" | "exchange" | "contract" | "unknown";
  isActive: boolean;
  notes?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWalletAddressRequest {
  address: string;
  blockchain: string;
  label?: string;
  addressType?: "personal" | "exchange" | "contract" | "unknown";
  notes?: string;
}

export interface UpdateWalletAddressRequest {
  label?: string | undefined;
  addressType?: "personal" | "exchange" | "contract" | "unknown";
  isActive?: boolean | undefined;
  notes?: string | undefined;
}

export interface WalletAddressQuery {
  blockchain?: string;
  addressType?: "personal" | "exchange" | "contract" | "unknown";
  isActive?: boolean | undefined;
  search?: string | undefined; // Search in address, label, or notes
}

// Enhanced transaction type with wallet address references
export interface TransactionWithAddresses extends EnhancedTransaction {
  fromAddress?: string | undefined;
  toAddress?: string | undefined;
  fromWalletId?: number | undefined;
  toWalletId?: number | undefined;
  isInternalTransfer?: boolean | undefined;
  fromWallet?: WalletAddress | undefined;
  toWallet?: WalletAddress | undefined;
}
