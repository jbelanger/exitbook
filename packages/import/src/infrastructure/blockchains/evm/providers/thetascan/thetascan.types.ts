// ThetaScan API types and interfaces for Theta blockchain

export interface ThetaScanTransaction {
  hash: string;
  sending_address: string;
  recieving_address: string;
  theta: string;
  tfuel: string;
  timestamp: number;
  block: string;
  fee_tfuel: number;
  type?: string;
  // Token transfer fields
  token_name?: string;
  token_symbol?: string;
  contract_address?: string;
}

export interface ThetaScanTokenTransfer {
  hash: string;
  sending_address: string;
  recieving_address: string;
  value: string;
  timestamp: number;
  block: string;
  contract_address: string;
  token_name?: string;
  token_symbol?: string;
  token_decimals?: number;
  type?: string;
}

export interface ThetaScanBalanceResponse {
  theta: string;
  theta_staked: string;
  tfuel: string;
  tfuel_staked: string;
}

export interface ThetaScanTokenBalance {
  contract_address: string;
  balance: string;
  token_name?: string;
  token_symbol?: string;
  token_decimals?: number;
}
