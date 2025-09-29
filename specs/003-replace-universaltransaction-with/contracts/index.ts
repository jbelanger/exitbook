/**
 * CQRS Contracts for ProcessedTransaction + Purpose Classifier (MVP)
 *
 * This module exports all command and query contracts with their handlers,
 * events, and error types for the transaction processing domain.
 *
 * Import Pattern Guidelines:
 * - Domain types (entities, value objects): from '../types/'
 * - Infrastructure (errors, events): from this contracts module
 * - External libraries (neverthrow): direct imports
 */

// Core Infrastructure
export * from './DomainError';
export * from './EventMetadata';

// Commands
export * from './ProcessTransactionCommand';
export * from './ClassifyMovementsCommand';
export * from './ValidateTransactionCommand';

// Queries
export * from './GetClassifiedTransactionQuery';
export * from './GetTransactionsBySourceQuery';
export * from './GetMovementsByPurposeQuery';

/**
 * MVP Validation Rules Summary
 *
 * These rules are enforced across the command/query contracts:
 *
 * 1. **Three-Purpose Constraint**: Only PRINCIPAL, FEE, GAS purposes allowed
 * 2. **Fee Direction Rule**: All FEE and GAS movements must be direction 'OUT'
 * 3. **Balance Rules**:
 *    - Trade principals must balance by currency
 *    - Transfer principals must net to zero (except gas fees)
 * 4. **Decimal Precision**: Max 18 decimal places, stored as strings
 * 5. **Deterministic Classification**: Same input always produces same output
 * 6. **Diagnostic Separation**: Confidence scores under `diagnostics` namespace
 * 7. **Idempotency**: All commands/queries include requestId for tracing
 * 8. **Fail-Fast Validation**: Failed validation rejects entire transaction
 */

/**
 * Supported Sources (MVP Scope)
 */
export const SUPPORTED_EXCHANGE_VENUES = ['kraken'] as const;
export const SUPPORTED_BLOCKCHAIN_CHAINS = ['ethereum'] as const;
export const SUPPORTED_PURPOSES = ['PRINCIPAL', 'FEE', 'GAS'] as const;

export type SupportedVenue = (typeof SUPPORTED_EXCHANGE_VENUES)[number];
export type SupportedChain = (typeof SUPPORTED_BLOCKCHAIN_CHAINS)[number];
export type SupportedPurpose = (typeof SUPPORTED_PURPOSES)[number];
