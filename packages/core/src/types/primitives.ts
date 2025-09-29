/**
 * Primitive Type Definitions
 *
 * Centralized primitive type aliases used across the domain model.
 * Single source of truth for all basic types to prevent inconsistencies.
 */

// Timestamp and ID types
export type IsoTimestamp = string; // ISO-8601 UTC timestamp
export type ExternalId = string; // Stable upstream identifier (venue tx id, txHash, etc.)
export type ImportSessionId = string; // Import session tracking identifier

// Money and financial types
export type DecimalString = string; // JSON-safe decimal with up to 18 decimal places
export type Currency = string; // Currency identifier: 'BTC', 'ETH', 'USDT', 'CAD', etc.

// Movement types
export type MovementId = string; // Unique movement identifier within transaction
export type MovementDirection = 'IN' | 'OUT'; // Money flow direction relative to user
export type MovementHint = 'FEE' | 'GAS'; // Optional hint for classifier
export type MovementPurpose = 'PRINCIPAL' | 'FEE' | 'GAS'; // Final classification purpose
export type MovementSequence = number; // Order within transaction

// Classification metadata types
export type RuleId = string; // Classification rule identifier (e.g., "exchange.kraken.trade.v1")
export type RuleVersion = string; // Semantic version of classification rules
export type RulesetVersion = string; // Semantic version of classification ruleset
export type Confidence = number; // 0..1 classification confidence score
