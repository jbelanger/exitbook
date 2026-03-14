import type { ThetaChainConfig } from './chain-config.interface.js';
import thetaChainsData from './theta-chains.json' with { type: 'json' };

const thetaChains = thetaChainsData as unknown as Record<string, ThetaChainConfig>;

export const THETA_CHAINS = thetaChains;

export type ThetaChainName = keyof typeof THETA_CHAINS;

export function getThetaChainConfig(chainName: string): ThetaChainConfig | undefined {
  return THETA_CHAINS[chainName];
}
