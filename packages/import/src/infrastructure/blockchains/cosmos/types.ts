/**
 * Cosmos fund flow analysis result - multi-asset tracking
 *
 * This structure follows the EVM pattern for consistency across all blockchain types,
 * while supporting Cosmos-specific features like IBC and bridge transfers.
 */
export interface CosmosFundFlow {
  // Multi-asset tracking (following EVM pattern)
  inflows: {
    amount: string;
    asset: string;
    tokenAddress?: string | undefined;
    tokenDecimals?: number | undefined;
  }[];
  outflows: {
    amount: string;
    asset: string;
    tokenAddress?: string | undefined;
    tokenDecimals?: number | undefined;
  }[];
  primary: {
    amount: string;
    asset: string;
    tokenAddress?: string | undefined;
    tokenDecimals?: number | undefined;
  };

  // Fee information (always in native currency)
  feeAmount: string;
  feeCurrency: string;

  // Address information
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
