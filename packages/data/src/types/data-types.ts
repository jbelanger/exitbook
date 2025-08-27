
// Database schema types for data persistence

export interface StoredTransaction {
  amount: string;
  amount_currency?: string;
  cost?: string;
  cost_currency?: string;
  created_at: number;
  datetime?: string;
  exchange: string;
  fee_cost?: string;
  fee_currency?: string;
  from_address?: string;
  hash: string;
  id: string;
  note_message?: string;
  note_metadata?: string; // JSON stringified metadata
  note_severity?: 'info' | 'warning' | 'error';
  note_type?: string;
  price?: string;
  price_currency?: string;
  raw_data: string; // JSON stringified transaction data
  side?: string;
  status?: string;
  symbol?: string;
  timestamp: number;
  to_address?: string;
  type: string;
  verified?: boolean;
  wallet_id?: number;
}

// Wallet address tracking types
export interface WalletAddress {
  address: string;
  addressType: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain: string;
  createdAt: number;
  id: number;
  isActive: boolean;
  label?: string | undefined;
  notes?: string | undefined;
  updatedAt: number;
}

export interface CreateWalletAddressRequest {
  address: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain: string;
  label?: string;
  notes?: string;
}

export interface UpdateWalletAddressRequest {
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive?: boolean | undefined;
  label?: string | undefined;
  notes?: string | undefined;
}

export interface WalletAddressQuery {
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain?: string;
  isActive?: boolean | undefined;
  search?: string | undefined; // Search in address, label, or notes
}