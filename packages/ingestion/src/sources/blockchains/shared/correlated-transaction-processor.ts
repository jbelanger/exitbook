import {
  maskAddress,
  ProviderError,
  type BlockchainProviderManager,
  type EvmTransaction,
} from '@exitbook/blockchain-providers';
import {
  buildBlockchainNativeAssetId,
  parseDecimal,
  type Currency,
  type OperationClassification,
} from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';

import type { MovementWithContext } from '../../../features/scam-detection/scam-detection-service.interface.js';
import { looksLikeContractAddress } from '../../../features/token-metadata/token-metadata-utils.js';
import type { AddressContext, ProcessedTransaction } from '../../../shared/types/processors.js';

export interface CorrelatedMovement {
  amount: string;
  asset: Currency;
  tokenAddress?: string | undefined;
}

/**
 * Minimum fund-flow contract required by the shared correlated-processing loop.
 *
 * Classification callbacks can require richer chain-specific shapes by binding
 * `TFundFlow` to a subtype such as `EvmFundFlow` or `ThetaFundFlow`.
 */
export interface CorrelatedFundFlow {
  feeAmount: string;
  feeCurrency: Currency;
  feePayerAddress?: string | undefined;
  fromAddress: string;
  inflows: CorrelatedMovement[];
  outflows: CorrelatedMovement[];
  toAddress?: string | undefined;
  transactionCount: number;
}

interface BuiltMovement {
  assetId: string;
  assetSymbol: Currency;
  grossAmount: ReturnType<typeof parseDecimal>;
  netAmount: ReturnType<typeof parseDecimal>;
}

export interface ProcessCorrelatedTransactionsParams<
  TTransaction extends EvmTransaction,
  TFundFlow extends CorrelatedFundFlow,
> {
  analyzeFundFlow: (txGroup: TTransaction[], context: AddressContext) => Result<TFundFlow, Error>;
  buildAssetId: (
    movement: {
      asset: string;
      tokenAddress?: string | undefined;
    },
    transactionHash: string
  ) => Result<string, Error>;
  buildProcessingFailureError: (failed: number, total: number, errors: { error: string; id: string }[]) => Error;
  chainName: string;
  context: AddressContext;
  contractAddressCache: Map<string, boolean>;
  // This may depend on fields beyond CorrelatedFundFlow's minimum orchestration contract.
  determineOperation: (fundFlow: TFundFlow, txGroup: TTransaction[]) => OperationClassification;
  groupTransactions: (transactions: TTransaction[]) => Map<string, TTransaction[]>;
  logger: Logger;
  normalizedData: TTransaction[];
  providerManager: BlockchainProviderManager;
  runScamDetection: (
    transactions: ProcessedTransaction[],
    movements: MovementWithContext[],
    chainName: string
  ) => Promise<void>;
  selectPrimaryTransaction: (txGroup: TTransaction[], fundFlow: TFundFlow) => TTransaction | undefined;
}

export async function processCorrelatedTransactions<
  TTransaction extends EvmTransaction,
  TFundFlow extends CorrelatedFundFlow,
>(
  params: ProcessCorrelatedTransactionsParams<TTransaction, TFundFlow>
): Promise<Result<ProcessedTransaction[], Error>> {
  const enrichResult = await enrichContractTokenMetadata(
    params.normalizedData,
    params.chainName,
    params.providerManager,
    params.logger
  );
  if (enrichResult.isErr()) {
    return err(new Error(`Token metadata enrichment failed: ${enrichResult.error.message}`));
  }

  const transactionGroups = params.groupTransactions(params.normalizedData);
  const accountIsContract = params.context.primaryAddress
    ? await resolveAccountIsContract(
        params.context.primaryAddress,
        params.chainName,
        params.providerManager,
        params.logger,
        params.contractAddressCache
      )
    : undefined;

  params.logger.debug(`Created ${transactionGroups.size} transaction groups for correlation on ${params.chainName}`);

  const transactions: ProcessedTransaction[] = [];
  const processingErrors: { error: string; hash: string; txCount: number }[] = [];
  const tokenMovementsForScamDetection: MovementWithContext[] = [];

  for (const [hash, txGroup] of transactionGroups) {
    const fundFlowResult = params.analyzeFundFlow(txGroup, params.context);
    if (fundFlowResult.isErr()) {
      const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error.message}`;
      processingErrors.push({ error: errorMsg, hash, txCount: txGroup.length });
      params.logger.error(
        `${errorMsg} for ${params.chainName} transaction ${hash} (${txGroup.length} correlated items) - THIS TRANSACTION GROUP WILL BE LOST`
      );
      continue;
    }

    const fundFlow = fundFlowResult.value;
    const classification = params.determineOperation(fundFlow, txGroup);
    const primaryTx = params.selectPrimaryTransaction(txGroup, fundFlow);

    if (!primaryTx) {
      const errorMsg = 'No primary transaction found for correlated group';
      processingErrors.push({ error: errorMsg, hash, txCount: txGroup.length });
      params.logger.error(
        `${errorMsg} ${hash} (${txGroup.length} items) - THIS TRANSACTION GROUP WILL BE LOST. Group types: ${txGroup.map((tx) => tx.type).join(', ')}`
      );
      continue;
    }

    const userInitiatedTransaction = (fundFlow.fromAddress || '') === params.context.primaryAddress;
    const feePayerMatches = (fundFlow.feePayerAddress || '') === params.context.primaryAddress;
    let shouldRecordFeeEntry = fundFlow.outflows.length > 0 || userInitiatedTransaction;
    if (accountIsContract === true) {
      shouldRecordFeeEntry = feePayerMatches;
    }

    const inflowsResult = buildProcessedMovements(fundFlow.inflows, hash, 'inflow', params.buildAssetId);
    if (inflowsResult.isErr()) {
      processingErrors.push({ error: inflowsResult.error.message, hash, txCount: txGroup.length });
      params.logger.error(
        `${inflowsResult.error.message} for ${params.chainName} transaction ${hash} - THIS TRANSACTION GROUP WILL BE LOST`
      );
      continue;
    }

    const outflowsResult = buildProcessedMovements(fundFlow.outflows, hash, 'outflow', params.buildAssetId);
    if (outflowsResult.isErr()) {
      processingErrors.push({ error: outflowsResult.error.message, hash, txCount: txGroup.length });
      params.logger.error(
        `${outflowsResult.error.message} for ${params.chainName} transaction ${hash} - THIS TRANSACTION GROUP WILL BE LOST`
      );
      continue;
    }

    const feeAssetIdResult = buildBlockchainNativeAssetId(params.chainName);
    if (feeAssetIdResult.isErr()) {
      const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
      processingErrors.push({ error: errorMsg, hash, txCount: txGroup.length });
      params.logger.error(
        `${errorMsg} for ${params.chainName} transaction ${hash} - THIS TRANSACTION GROUP WILL BE LOST`
      );
      continue;
    }

    const inflows = inflowsResult.value;
    const outflows = outflowsResult.value;
    const processedTransaction: ProcessedTransaction = {
      externalId: primaryTx.id,
      datetime: new Date(primaryTx.timestamp).toISOString(),
      timestamp: primaryTx.timestamp,
      source: params.chainName,
      sourceType: 'blockchain',
      status: primaryTx.status,
      from: fundFlow.fromAddress || primaryTx.from,
      to: fundFlow.toAddress || primaryTx.to,
      movements: {
        inflows,
        outflows,
      },
      fees:
        shouldRecordFeeEntry && !parseDecimal(fundFlow.feeAmount).isZero()
          ? [
              {
                assetId: feeAssetIdResult.value,
                assetSymbol: fundFlow.feeCurrency,
                amount: parseDecimal(fundFlow.feeAmount),
                scope: 'network',
                settlement: 'balance',
              },
            ]
          : [],
      operation: classification.operation,
      notes: classification.notes,
      blockchain: {
        name: params.chainName,
        block_height: primaryTx.blockHeight,
        transaction_hash: primaryTx.id,
        is_confirmed: primaryTx.status === 'success',
      },
    };

    const hasMovements = inflows.length > 0 || outflows.length > 0;
    if (!hasMovements && processedTransaction.fees.length === 0) {
      params.logger.debug(`Dropping zero-impact transaction ${hash} on ${params.chainName} (no movements, no fees)`);
      continue;
    }

    const allMovements = [...fundFlow.inflows, ...fundFlow.outflows];
    const isAirdrop = fundFlow.outflows.length === 0 && !userInitiatedTransaction;

    for (const movement of allMovements) {
      if (!movement.tokenAddress) {
        continue;
      }

      tokenMovementsForScamDetection.push({
        contractAddress: movement.tokenAddress,
        asset: movement.asset,
        amount: parseDecimal(movement.amount),
        isAirdrop,
        transactionIndex: transactions.length,
      });
    }

    transactions.push(processedTransaction);
    params.logger.debug(
      `Successfully processed correlated transaction group ${processedTransaction.externalId} (${fundFlow.transactionCount} items)`
    );
  }

  await params.runScamDetection(transactions, tokenMovementsForScamDetection, params.chainName);

  if (processingErrors.length > 0) {
    params.logger.error(
      `CRITICAL PROCESSING FAILURE for ${params.chainName}:\n${processingErrors
        .map(
          (item, index) => `  ${index + 1}. [${item.hash.substring(0, 10)}...] ${item.error} (${item.txCount} items)`
        )
        .join('\n')}`
    );

    return err(
      params.buildProcessingFailureError(
        processingErrors.length,
        transactionGroups.size,
        processingErrors.map((item) => ({ id: item.hash, error: item.error }))
      )
    );
  }

  return ok(transactions);
}

async function enrichContractTokenMetadata(
  transactions: EvmTransaction[],
  chainName: string,
  providerManager: BlockchainProviderManager,
  logger: Logger
): Promise<Result<void, Error>> {
  const tokenTransfers = transactions.filter(
    (tx) => tx.type === 'token_transfer' && !!tx.tokenAddress && looksLikeContractAddress(tx.tokenAddress, 40)
  );
  if (tokenTransfers.length === 0) {
    return ok(undefined);
  }

  const addresses = [...new Set(tokenTransfers.map((tx) => tx.tokenAddress!))];
  const result = await providerManager.getTokenMetadata(chainName, addresses);
  if (result.isErr()) {
    return err(result.error);
  }

  const metadataMap = result.value;
  for (const tx of tokenTransfers) {
    const metadata = metadataMap.get(tx.tokenAddress!);
    if (!metadata) {
      continue;
    }

    if (metadata.symbol) {
      tx.currency = metadata.symbol;
      tx.tokenSymbol = metadata.symbol;
    }

    if (metadata.decimals !== undefined && tx.tokenDecimals === undefined) {
      logger.debug(`Updating decimals for ${tx.tokenAddress} from ${tx.tokenDecimals} to ${metadata.decimals}`);
      tx.tokenDecimals = metadata.decimals;
    }
  }

  return ok(undefined);
}

async function resolveAccountIsContract(
  address: string,
  chainName: string,
  providerManager: BlockchainProviderManager,
  logger: Logger,
  contractAddressCache: Map<string, boolean>
): Promise<boolean | undefined> {
  const cached = contractAddressCache.get(address);
  if (cached !== undefined) {
    return cached;
  }

  const result = await providerManager.getAddressInfo(chainName, address);
  if (result.isErr()) {
    const error = result.error;
    if (error instanceof ProviderError) {
      logger.warn(
        { address: maskAddress(address), code: error.code, error: error.message },
        'Failed to resolve address type for fee attribution'
      );
    } else {
      logger.warn({ address: maskAddress(address), error }, 'Failed to resolve address type for fee attribution');
    }
    return undefined;
  }

  const isContract = result.value.data.isContract;
  contractAddressCache.set(address, isContract);
  return isContract;
}

function buildProcessedMovements(
  movements: CorrelatedMovement[],
  transactionHash: string,
  direction: 'inflow' | 'outflow',
  buildAssetId: ProcessCorrelatedTransactionsParams<EvmTransaction, CorrelatedFundFlow>['buildAssetId']
): Result<BuiltMovement[], Error> {
  const built: BuiltMovement[] = [];

  for (const movement of movements) {
    const assetIdResult = buildAssetId(movement, transactionHash);
    if (assetIdResult.isErr()) {
      return err(new Error(`Failed to build assetId for ${direction}: ${assetIdResult.error.message}`));
    }

    const amount = parseDecimal(movement.amount);
    built.push({
      assetId: assetIdResult.value,
      assetSymbol: movement.asset,
      grossAmount: amount,
      netAmount: amount,
    });
  }

  return ok(built);
}
