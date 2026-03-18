import {
  type BlockchainProviderManager,
  EvmTransactionSchema,
  type ThetaChainConfig,
} from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId } from '@exitbook/core';
import { err, type Result } from '@exitbook/core';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import { looksLikeContractAddress } from '../../../features/token-metadata/token-metadata-utils.js';
import type { TransactionDraft, AddressContext } from '../../../shared/types/processors.js';
import { processCorrelatedTransactions } from '../shared/correlated-transaction-processor.js';

import {
  analyzeThetaFundFlow,
  determineThetaOperationFromFundFlow,
  findThetaNativeAssetBySymbol,
  groupThetaTransactionsByHash,
  selectPrimaryThetaTransaction,
} from './processor-utils.js';
import type { ThetaTransaction } from './types.js';

export class ThetaProcessor extends BaseTransactionProcessor<ThetaTransaction> {
  declare protected readonly providerManager: BlockchainProviderManager;
  private readonly contractAddressCache = new Map<string, boolean>();

  constructor(
    private readonly chainConfig: ThetaChainConfig,
    providerManager: BlockchainProviderManager,
    scamDetectionService?: IScamDetectionService
  ) {
    super(chainConfig.chainName, providerManager, scamDetectionService);
  }

  protected get inputSchema() {
    return EvmTransactionSchema;
  }

  protected async transformNormalizedData(
    normalizedData: ThetaTransaction[],
    context: AddressContext
  ): Promise<Result<TransactionDraft[], Error>> {
    return processCorrelatedTransactions({
      chainName: this.chainConfig.chainName,
      normalizedData,
      context,
      logger: this.logger,
      providerManager: this.providerManager,
      contractAddressCache: this.contractAddressCache,
      runScamDetection: (transactions, movements, chainName) =>
        this.runScamDetection(transactions, movements, chainName),
      buildProcessingFailureError: (failed, total, errors) => this.buildProcessingFailureError(failed, total, errors),
      groupTransactions: groupThetaTransactionsByHash,
      analyzeFundFlow: (txGroup, addressContext) => analyzeThetaFundFlow(txGroup, addressContext, this.chainConfig),
      determineOperation: determineThetaOperationFromFundFlow,
      selectPrimaryTransaction: selectPrimaryThetaTransaction,
      buildAssetId: (movement, transactionHash) => this.buildThetaAssetId(movement, transactionHash),
    });
  }

  private buildThetaAssetId(
    movement: {
      asset: string;
      tokenAddress?: string | undefined;
    },
    transactionHash: string
  ): Result<string, Error> {
    if (!movement.tokenAddress) {
      const nativeAsset = findThetaNativeAssetBySymbol(this.chainConfig, movement.asset);
      if (nativeAsset) {
        if (nativeAsset.role === 'gas') {
          return buildBlockchainNativeAssetId(this.chainConfig.chainName);
        }

        return buildBlockchainTokenAssetId(this.chainConfig.chainName, movement.asset.toLowerCase());
      }

      if (looksLikeContractAddress(movement.asset, 40)) {
        return err(
          new Error(
            `Missing tokenAddress for token-like asset symbol ${movement.asset} in transaction ${transactionHash}`
          )
        );
      }

      return err(
        new Error(`Missing tokenAddress for non-native asset ${movement.asset} in transaction ${transactionHash}`)
      );
    }

    return buildBlockchainTokenAssetId(this.chainConfig.chainName, movement.tokenAddress);
  }
}
