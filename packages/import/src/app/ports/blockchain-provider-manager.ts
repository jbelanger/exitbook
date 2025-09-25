/**
 * Port interface for blockchain provider management.
 * Abstracts blockchain provider infrastructure from the application layer.
 */
export interface IBlockchainProviderManager {
  destroy(): void;
}
