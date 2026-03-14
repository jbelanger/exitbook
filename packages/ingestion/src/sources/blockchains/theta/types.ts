import type { ThetaChainConfig, EvmTransaction } from '@exitbook/blockchain-providers';

import type { EvmFundFlow, EvmMovement } from '../evm/types.js';

export type ThetaTransaction = EvmTransaction;
export type ThetaMovement = EvmMovement;
export type ThetaFundFlow = EvmFundFlow;
export type ThetaNativeAsset = ThetaChainConfig['nativeAssets'][number];
