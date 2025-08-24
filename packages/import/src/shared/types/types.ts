// Import results types - shared by exchange and blockchain adapters
export interface ImportResult {
  source: string; // Exchange or blockchain identifier
  transactions: number;
  newTransactions: number;
  duplicatesSkipped: number;
  errors: string[];
  duration: number;
}

export interface ImportSummary {
  totalTransactions: number;
  newTransactions: number;
  duplicatesSkipped: number;
  sourceResults: ImportResult[]; // Results from all sources (exchanges + blockchains)
  errors: string[];
  duration: number;
}

// Transaction Note Types - Enum for standardized transaction annotations
export enum TransactionNoteType {
  // Security & Scam Detection
  SCAM_TOKEN = 'SCAM_TOKEN',
  SUSPICIOUS_AIRDROP = 'SUSPICIOUS_AIRDROP',

  // Transaction Quality
  DUST_TRANSACTION = 'DUST_TRANSACTION',
  FAILED_TRANSACTION = 'FAILED_TRANSACTION',
  HIGH_FEE = 'HIGH_FEE',

  // Transfer Types
  INTERNAL_TRANSFER = 'INTERNAL_TRANSFER',
  STAKING_REWARD = 'STAKING_REWARD',
  UNSTAKING = 'UNSTAKING',

  // Exchange Operations
  PARTIAL_FILL = 'PARTIAL_FILL',
  MARGIN_LIQUIDATION = 'MARGIN_LIQUIDATION',

  // Airdrops & Rewards
  LEGITIMATE_AIRDROP = 'LEGITIMATE_AIRDROP',
  MINING_REWARD = 'MINING_REWARD',
  VALIDATOR_REWARD = 'VALIDATOR_REWARD',

  // Special Cases
  DUST_SWEEP = 'DUST_SWEEP',
  NETWORK_FEE_ONLY = 'NETWORK_FEE_ONLY',
  TEST_TRANSACTION = 'TEST_TRANSACTION',
}
