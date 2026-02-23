import type { Currency } from '@exitbook/core';

/** A single asset movement with Cosmos-specific denomination metadata. */
export interface CosmosAssetMovement {
  amount: string;
  asset: Currency;
  /** Denomination (e.g., uatom, ibc/..., factory/...) */
  denom?: string | undefined;
  tokenDecimals?: number | undefined;
}

/**
 * Cosmos fund flow analysis result - multi-asset tracking
 *
 * Supports Cosmos-specific features like IBC and bridge transfers.
 */
export interface CosmosFundFlow {
  inflows: CosmosAssetMovement[];
  outflows: CosmosAssetMovement[];
  primary: CosmosAssetMovement;

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
  sourceChain?: string | undefined;
  destinationChain?: string | undefined;

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined;
}
