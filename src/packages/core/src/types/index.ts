// Core types and interfaces
export type { Decimal } from 'decimal.js';

// Universal transaction and exchange types
export type {
  ApiResponse, AppConfig, Balance, BalanceComparison, BalanceSnapshot,
  BalanceVerificationRecord, BalanceVerificationResult, BlockchainBalance, BlockchainCapabilities, BlockchainInfo, BlockchainTransaction, CacheConfig, CLIOptions, CreateWalletAddressRequest, CryptoTransaction, EnhancedTransaction, ExchangeBalance, ExchangeCapabilities, ExchangeConfig, ExchangeCredentials, ExchangeInfo, ExchangeOptions, IBlockchainAdapter, IExchangeAdapter, ImportResult,
  ImportSummary,
  LogContext, Money, StoredTransaction, TokenConfig, TransactionNote, TransactionStatus, TransactionType, TransactionWithAddresses, UpdateWalletAddressRequest, WalletAddress, WalletAddressQuery
} from './core-types.ts';

export {
  AuthenticationError, RateLimitError, ServiceError, TransactionNoteType
} from './core-types.ts';

// Provider system types
export type {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderOperation,
  RateLimitConfig
} from './contracts.ts';

// Blockchain-specific types
export * from './avalanche.ts';
export * from './bitcoin.ts';
export * from './ethereum.ts';
export * from './injective.ts';
export * from './solana.ts';
export * from './substrate.ts';

