import type { MovementRole } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';

/**
 * Cardano movement object representing a single asset transfer
 */
export interface CardanoMovement {
  amount: string;
  asset: Currency;
  decimals?: number | undefined;
  movementRole?: MovementRole | undefined;
  policyId?: string | undefined; // Policy ID for native tokens
  assetName?: string | undefined; // Asset name for native tokens
  unit: string; // Full unit identifier (lovelace for ADA, policyId+assetName for tokens)
}

/**
 * Cardano fund flow analysis result
 */
export interface CardanoFundFlow {
  // Asset movements
  inflows: CardanoMovement[];
  outflows: CardanoMovement[];

  // Primary asset (largest movement for simplified display)
  primary: CardanoMovement;

  // Fee information (always in ADA)
  feeAmount: string;
  feeCurrency: Currency;
  feePaidByUser: boolean;

  // Cardano-specific wallet-scope semantics
  attributedWithdrawalAmount?: string | undefined;
  unattributedWithdrawalAmount?: string | undefined;

  // Addresses involved
  fromAddress?: string | undefined;
  toAddress?: string | undefined;

  // Flow direction
  isIncoming: boolean;
  isOutgoing: boolean;

  // Transaction metadata
  inputCount: number;
  outputCount: number;

  // Generic operation-classification uncertainty only.
  // Specific typed residual semantics must use dedicated diagnostics instead.
  operationClassificationUncertainty?: string | undefined;
}
