import { type ThetaChainConfig } from '@exitbook/blockchain-providers/theta';
import type { OperationClassification } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';

import type { AddressContext } from '../../../shared/types/processors.js';
import {
  analyzeEvmFundFlow,
  determineAccountBasedOperationFromFundFlow,
  groupEvmTransactionsByHash,
  selectPrimaryEvmTransaction,
  type AccountBasedNativeCurrencyConfig,
} from '../evm/processor-utils.js';

import type { ThetaFundFlow, ThetaNativeAsset, ThetaTransaction } from './types.js';

function matchesThetaNativeAsset(asset: ThetaNativeAsset, symbol: string): boolean {
  return asset.symbol.trim().toLowerCase() === symbol.trim().toLowerCase();
}

export function findThetaNativeAssetBySymbol(
  chainConfig: ThetaChainConfig,
  symbol: string
): ThetaNativeAsset | undefined {
  return chainConfig.nativeAssets.find((asset) => matchesThetaNativeAsset(asset, symbol));
}

function getThetaGasAsset(chainConfig: ThetaChainConfig): Result<ThetaNativeAsset, Error> {
  const gasAsset = chainConfig.nativeAssets.find((asset) => asset.role === 'gas');
  if (!gasAsset) {
    return err(new Error(`Theta chain ${chainConfig.chainName} is missing a gas-native asset configuration`));
  }

  return ok(gasAsset);
}

function buildThetaFundFlowConfig(chainConfig: ThetaChainConfig): Result<AccountBasedNativeCurrencyConfig, Error> {
  const gasAssetResult = getThetaGasAsset(chainConfig);
  if (gasAssetResult.isErr()) {
    return err(gasAssetResult.error);
  }

  return ok({
    nativeCurrency: gasAssetResult.value.symbol,
    nativeDecimals: gasAssetResult.value.decimals,
  });
}

export function groupThetaTransactionsByHash(transactions: ThetaTransaction[]): Map<string, ThetaTransaction[]> {
  return groupEvmTransactionsByHash(transactions);
}

export function analyzeThetaFundFlow(
  txGroup: ThetaTransaction[],
  context: AddressContext,
  chainConfig: ThetaChainConfig
): Result<ThetaFundFlow, Error> {
  const fundFlowConfigResult = buildThetaFundFlowConfig(chainConfig);
  if (fundFlowConfigResult.isErr()) {
    return err(fundFlowConfigResult.error);
  }

  return analyzeEvmFundFlow(txGroup, context, fundFlowConfigResult.value);
}

export function determineThetaOperationFromFundFlow(
  fundFlow: ThetaFundFlow,
  _txGroup: ThetaTransaction[]
): OperationClassification {
  return determineAccountBasedOperationFromFundFlow(fundFlow);
}

export function selectPrimaryThetaTransaction(
  txGroup: ThetaTransaction[],
  fundFlow: ThetaFundFlow
): ThetaTransaction | undefined {
  return selectPrimaryEvmTransaction(txGroup, fundFlow);
}
