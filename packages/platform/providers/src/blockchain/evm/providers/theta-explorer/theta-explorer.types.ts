// Theta Explorer API response types

/**
 * Transaction types in Theta blockchain
 * 0: coinbase transaction, for validator/guardian reward
 * 1: slash transaction, for slashing malicious actors
 * 2: send transaction, for sending tokens among accounts
 * 3: reserve fund transaction, for off-chain micropayment
 * 4: release fund transaction, for off-chain micropayment
 * 5: service payment transaction, for off-chain micropayment
 * 6: split rule transaction, for the "split rule" special smart contract
 * 7: smart contract transaction, for general purpose smart contract
 * 8: deposit stake transaction, for depositing stake to validators/guardians
 * 9: withdraw stake transaction, for withdrawing stake from validators/guardians
 */
export type ThetaTransactionType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Theta blockchain coin balances (thetawei and tfuelwei)
 */
export interface ThetaCoins {
  tfuelwei: string;
  thetawei: string;
}

/**
 * Account information with address, coins, sequence, and signature
 */
export interface ThetaAccount {
  address: string;
  coins: ThetaCoins;
  sequence?: string;
  signature?: string;
}

/**
 * Send transaction data (type 2)
 */
export interface ThetaSendTransactionData {
  fee?: ThetaCoins;
  inputs?: ThetaAccount[];
  outputs?: ThetaAccount[];
  source?: ThetaAccount;
  target?: ThetaAccount;
}

/**
 * Smart contract transaction data (type 7)
 */
export interface ThetaSmartContractData {
  from: ThetaAccount;
  gas_limit: string;
  gas_price: string;
  to: ThetaAccount;
}

/**
 * Theta transaction response from API
 */
export interface ThetaTransaction {
  block_height: string;
  data: ThetaSendTransactionData | ThetaSmartContractData | Record<string, unknown>;
  hash: string;
  number?: number;
  timestamp: string;
  type: ThetaTransactionType;
}

/**
 * Account transaction history response
 */
export interface ThetaAccountTxResponse {
  body: ThetaTransaction[];
  currentPageNumber: number;
  totalPageNumber: number;
  type: 'account_tx_list';
}
