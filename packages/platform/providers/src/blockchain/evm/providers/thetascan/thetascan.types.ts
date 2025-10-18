// ThetaScan API types and interfaces for Theta blockchain

export interface ThetaScanTransaction {
  hash: string;
  sending_address: string;
  recieving_address: string;
  theta: string;
  tfuel: string;
  timestamp: Date;
  block: string;
  fee_tfuel: number;
  type?: string;
  // Token transfer fields
  token_name?: string;
  token_symbol?: string;
  contract_address?: string;
}

export interface ThetaScanBalanceResponse {
  theta: string | number;
  theta_staked: string | number;
  tfuel: string | number;
  tfuel_staked: string | number;
}

export interface ThetaScanTokenBalance {
  contract_address: string;
  balance: string | number;
  token_name?: string;
  token_symbol?: string;
  token_decimals?: number;
}
