import type { ThetaChainConfig } from '@exitbook/blockchain-providers/theta';
import { err, ok, type Result } from '@exitbook/foundation';

import type { AccountBasedLedgerChainConfig } from '../evm/journal-assembler-types.js';
import { EvmProcessorV2, type EvmProcessorV2Options } from '../evm/processor-v2.js';

function buildThetaLedgerChainConfig(chainConfig: ThetaChainConfig): Result<AccountBasedLedgerChainConfig, Error> {
  const gasAsset = chainConfig.nativeAssets.find((asset) => asset.role === 'gas');
  if (!gasAsset) {
    return err(new Error(`Theta chain ${chainConfig.chainName} is missing a gas-native asset configuration`));
  }

  return ok({
    chainName: chainConfig.chainName,
    nativeCurrency: gasAsset.symbol,
    nativeDecimals: gasAsset.decimals,
    nativeAssets: chainConfig.nativeAssets.map((asset) => ({
      assetIdKind: asset.role === 'gas' ? ('native_asset' as const) : ('symbol_asset' as const),
      decimals: asset.decimals,
      symbol: asset.symbol,
    })),
  });
}

export class ThetaProcessorV2 extends EvmProcessorV2 {
  constructor(chainConfig: ThetaChainConfig, options: EvmProcessorV2Options = {}) {
    const ledgerChainConfigResult = buildThetaLedgerChainConfig(chainConfig);
    if (ledgerChainConfigResult.isErr()) {
      throw ledgerChainConfigResult.error;
    }

    super(ledgerChainConfigResult.value, options);
  }
}
