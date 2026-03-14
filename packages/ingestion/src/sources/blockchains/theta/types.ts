import type { ThetaChainConfig, EvmTransaction } from '@exitbook/blockchain-providers';

import type { EvmFundFlow } from '../evm/types.js';

export type ThetaTransaction = EvmTransaction;
export type ThetaFundFlow = EvmFundFlow;
export type ThetaNativeAsset = ThetaChainConfig['nativeAssets'][number];
