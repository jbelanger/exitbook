// Import results types - shared by exchange and blockchain adapters
export interface ImportResult {
  duplicatesSkipped: number;
  duration: number;
  errors: string[];
  newTransactions: number;
  source: string; // Exchange or blockchain identifier
  transactions: number;
}

export interface ImportSummary {
  duplicatesSkipped: number;
  duration: number;
  errors: string[];
  newTransactions: number;
  sourceResults: ImportResult[]; // Results from all sources (exchanges + blockchains)
  totalTransactions: number;
}

// Transaction Note Types - Enum for standardized transaction annotations
export enum TransactionNoteType {
  // Special Cases
  DUST_SWEEP = 'DUST_SWEEP',
  // Transaction Quality
  DUST_TRANSACTION = 'DUST_TRANSACTION',

  FAILED_TRANSACTION = 'FAILED_TRANSACTION',
  HIGH_FEE = 'HIGH_FEE',
  // Transfer Types
  INTERNAL_TRANSFER = 'INTERNAL_TRANSFER',

  // Airdrops & Rewards
  LEGITIMATE_AIRDROP = 'LEGITIMATE_AIRDROP',
  MARGIN_LIQUIDATION = 'MARGIN_LIQUIDATION',
  MINING_REWARD = 'MINING_REWARD',

  NETWORK_FEE_ONLY = 'NETWORK_FEE_ONLY',
  // Exchange Operations
  PARTIAL_FILL = 'PARTIAL_FILL',

  // Security & Scam Detection
  SCAM_TOKEN = 'SCAM_TOKEN',
  STAKING_REWARD = 'STAKING_REWARD',
  SUSPICIOUS_AIRDROP = 'SUSPICIOUS_AIRDROP',

  TEST_TRANSACTION = 'TEST_TRANSACTION',
  UNSTAKING = 'UNSTAKING',
  VALIDATOR_REWARD = 'VALIDATOR_REWARD',
}
