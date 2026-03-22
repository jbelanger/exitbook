import { type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import { type ThetaChainConfig } from '@exitbook/blockchain-providers/theta';

import type { EvmFundFlow } from '../evm/types.js';

export type ThetaTransaction = EvmTransaction;
export type ThetaFundFlow = EvmFundFlow;
export type ThetaNativeAsset = ThetaChainConfig['nativeAssets'][number];
