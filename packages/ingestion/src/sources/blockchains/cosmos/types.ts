import type { Currency } from '@exitbook/core';

/**
 * Cosmos fund flow analysis result - multi-asset tracking
 *
 * Supports Cosmos-specific features like IBC and bridge transfers.
 */
export interface CosmosFundFlow {
  // Multi-asset tracking with Cosmos-specific terminology
  inflows: {
    amount: string;
    asset: Currency;
    denom?: string | undefined; // Denomination (e.g., uatom, ibc/..., factory/...)
    tokenDecimals?: number | undefined;
  }[];
  outflows: {
    amount: string;
    asset: Currency;
    denom?: string | undefined; // Denomination (e.g., uatom, ibc/..., factory/...)
    tokenDecimals?: number | undefined;
  }[];
  primary: {
    amount: string;
    asset: Currency;
    denom?: string | undefined; // Denomination (e.g., uatom, ibc/..., factory/...)
    tokenDecimals?: number | undefined;
  };

  // Fee information (always in native currency)
  feeAmount: string;
  feeCurrency: Currency;

  fromAddress: string;
  toAddress: string;

  // Transaction context flags
  hasContractInteraction: boolean;
  hasBridgeTransfer: boolean;
  hasIbcTransfer: boolean;

  // Bridge/IBC specific metadata
  bridgeType?: 'peggy' | 'gravity' | 'ibc' | 'native' | undefined;
  sourceChain?: string | undefined; // For IBC transfers
  destinationChain?: string | undefined; // For IBC transfers

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined;
}
