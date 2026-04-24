import {
  canonicalizeBitcoinAddress,
  type BitcoinChainConfig,
  type BitcoinTransaction,
  type BitcoinTransactionInput,
  type BitcoinTransactionOutput,
} from '@exitbook/blockchain-providers/bitcoin';
import {
  buildBlockchainNativeAssetId,
  err,
  ok,
  parseCurrency,
  parseDecimal,
  resultDo,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import {
  computeSourceActivityFingerprint,
  type AccountingDiagnosticDraft,
  type AccountingJournalDraft,
  type AccountingPostingDraft,
  type SourceActivityDraft,
  type SourceComponentQuantityRef,
} from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import {
  buildSourceComponentQuantityRef,
  parseLedgerDecimalAmount,
  validateLedgerProcessorAccountContext,
} from '../shared/ledger-assembler-utils.js';
import { buildUtxoSourceComponentId } from '../shared/ledger-utxo-utils.js';

export interface BitcoinProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface BitcoinProcessorV2Context {
  account: BitcoinProcessorV2AccountContext;
  walletAddresses: readonly string[];
}

export interface BitcoinLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

interface BitcoinNativeAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

interface WalletNativeTotals {
  walletInputAmount: Decimal;
  walletOutputAmount: Decimal;
  walletInputs: BitcoinTransactionInput[];
  walletOutputs: BitcoinTransactionOutput[];
}

interface BitcoinJournalAssemblyParts {
  diagnostics: readonly AccountingDiagnosticDraft[];
  feePosting: AccountingPostingDraft | undefined;
  principalPosting: AccountingPostingDraft | undefined;
  sourceActivityFingerprint: string;
}

function normalizeWalletAddressSet(walletAddresses: readonly string[]): Result<ReadonlySet<string>, Error> {
  const normalizedAddresses = walletAddresses
    .map((address) => address.trim())
    .filter((address) => address.length > 0)
    .map((address) => canonicalizeBitcoinAddress(address));

  if (normalizedAddresses.length === 0) {
    return err(new Error('Bitcoin v2 wallet address scope must contain at least one address'));
  }

  return ok(new Set(normalizedAddresses));
}

function validateBitcoinProcessorV2Context(context: BitcoinProcessorV2Context): Result<ReadonlySet<string>, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'Bitcoin v2');
    return yield* normalizeWalletAddressSet(context.walletAddresses);
  });
}

function validateBitcoinChainConfig(chainConfig: BitcoinChainConfig): Result<void, Error> {
  if (chainConfig.chainName.trim() === '') {
    return err(new Error('Bitcoin v2 chain name must not be empty'));
  }

  if (!Number.isInteger(chainConfig.nativeDecimals) || chainConfig.nativeDecimals < 0) {
    return err(
      new Error(`Bitcoin v2 native decimals must be a non-negative integer, got ${chainConfig.nativeDecimals}`)
    );
  }

  return ok(undefined);
}

function validateBitcoinTransactionCurrency(
  transaction: BitcoinTransaction,
  chainConfig: BitcoinChainConfig
): Result<void, Error> {
  if (transaction.currency !== chainConfig.nativeCurrency) {
    return err(
      new Error(
        `Bitcoin v2 transaction ${transaction.id} currency ${transaction.currency} does not match chain ${chainConfig.chainName} native currency ${chainConfig.nativeCurrency}`
      )
    );
  }

  if (transaction.feeCurrency !== undefined && transaction.feeCurrency !== chainConfig.nativeCurrency) {
    return err(
      new Error(
        `Bitcoin v2 transaction ${transaction.id} fee currency ${transaction.feeCurrency} does not match chain ${chainConfig.chainName} native currency ${chainConfig.nativeCurrency}`
      )
    );
  }

  return ok(undefined);
}

function validateBitcoinTransactionAmounts(transaction: BitcoinTransaction): Result<Decimal, Error> {
  return resultDo(function* () {
    for (const input of transaction.inputs) {
      const amount = yield* parseLedgerDecimalAmount({
        label: 'input',
        processorLabel: 'Bitcoin v2',
        transactionId: transaction.id,
        value: input.value,
      });
      if (amount.isNegative()) {
        return yield* err(new Error(`Bitcoin v2 transaction ${transaction.id} input amount must not be negative`));
      }
    }

    for (const output of transaction.outputs) {
      const amount = yield* parseLedgerDecimalAmount({
        label: 'output',
        processorLabel: 'Bitcoin v2',
        transactionId: transaction.id,
        value: output.value,
      });
      if (amount.isNegative()) {
        return yield* err(new Error(`Bitcoin v2 transaction ${transaction.id} output amount must not be negative`));
      }
    }

    const feeAmount = yield* parseLedgerDecimalAmount({
      allowMissing: true,
      label: 'fee',
      processorLabel: 'Bitcoin v2',
      transactionId: transaction.id,
      value: transaction.feeAmount,
    });
    if (feeAmount.isNegative()) {
      return yield* err(new Error(`Bitcoin v2 transaction ${transaction.id} fee amount must not be negative`));
    }

    return feeAmount;
  });
}

function isWalletAddress(address: string | undefined, walletAddresses: ReadonlySet<string>): boolean {
  return address !== undefined && walletAddresses.has(canonicalizeBitcoinAddress(address));
}

function normalizeBitcoinNativeQuantity(value: string, nativeDecimals: number): Decimal {
  return parseDecimal(value).div(new Decimal(10).pow(nativeDecimals));
}

function collectWalletNativeTotals(
  transaction: BitcoinTransaction,
  walletAddresses: ReadonlySet<string>,
  nativeDecimals: number
): WalletNativeTotals {
  const walletInputs = transaction.inputs.filter((input) => isWalletAddress(input.address, walletAddresses));
  const walletOutputs = transaction.outputs.filter((output) => isWalletAddress(output.address, walletAddresses));
  const walletInputAmount = walletInputs.reduce(
    (sum, input) => sum.plus(normalizeBitcoinNativeQuantity(input.value, nativeDecimals)),
    new Decimal(0)
  );
  const walletOutputAmount = walletOutputs.reduce(
    (sum, output) => sum.plus(normalizeBitcoinNativeQuantity(output.value, nativeDecimals)),
    new Decimal(0)
  );

  return {
    walletInputAmount,
    walletOutputAmount,
    walletInputs,
    walletOutputs,
  };
}

function validateWalletScopeEffect(
  transaction: BitcoinTransaction,
  walletNativeTotals: WalletNativeTotals
): Result<void, Error> {
  if (walletNativeTotals.walletInputAmount.isZero() && walletNativeTotals.walletOutputAmount.isZero()) {
    return err(new Error(`Bitcoin v2 transaction ${transaction.id} has no effect for the wallet address scope`));
  }

  return ok(undefined);
}

function findFirstExternalAddress(
  entries: readonly { address?: string | undefined }[],
  walletAddresses: ReadonlySet<string>
): string | undefined {
  return entries.find((entry) => entry.address !== undefined && !isWalletAddress(entry.address, walletAddresses))
    ?.address;
}

function buildBitcoinNativeAssetRef(chainConfig: BitcoinChainConfig): Result<BitcoinNativeAssetRef, Error> {
  return resultDo(function* () {
    const assetId = yield* buildBlockchainNativeAssetId(chainConfig.chainName);
    return {
      assetId,
      assetSymbol: chainConfig.nativeCurrency,
    };
  });
}

function buildUtxoInputComponentId(transactionId: string, input: BitcoinTransactionInput): Result<string, Error> {
  if (!input.txid?.trim()) {
    return err(new Error(`Bitcoin v2 wallet input in transaction ${transactionId} is missing previous txid`));
  }

  const vout = input.vout;
  if (typeof vout !== 'number' || !Number.isInteger(vout) || vout < 0) {
    return err(new Error(`Bitcoin v2 wallet input ${input.txid} in transaction ${transactionId} is missing vout`));
  }

  return ok(
    buildUtxoSourceComponentId({
      outputIndex: vout,
      transactionHash: input.txid,
    })
  );
}

function buildUtxoOutputComponentId(transactionId: string, output: BitcoinTransactionOutput): Result<string, Error> {
  if (!Number.isInteger(output.index) || output.index < 0) {
    return err(new Error(`Bitcoin v2 wallet output in transaction ${transactionId} is missing output index`));
  }

  return ok(
    buildUtxoSourceComponentId({
      outputIndex: output.index,
      transactionHash: transactionId,
    })
  );
}

function buildPrincipalInputComponentRefs(params: {
  assetId: string;
  nativeDecimals: number;
  sourceActivityFingerprint: string;
  transactionId: string;
  walletInputs: readonly BitcoinTransactionInput[];
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];

    for (const input of params.walletInputs) {
      const quantity = normalizeBitcoinNativeQuantity(input.value, params.nativeDecimals);
      if (quantity.isZero()) {
        continue;
      }

      const componentId = yield* buildUtxoInputComponentId(params.transactionId, input);
      refs.push(
        buildSourceComponentQuantityRef({
          assetId: params.assetId,
          componentId,
          componentKind: 'utxo_input',
          quantity,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        })
      );
    }

    return refs;
  });
}

function buildPrincipalOutputComponentRefs(params: {
  assetId: string;
  nativeDecimals: number;
  sourceActivityFingerprint: string;
  transactionId: string;
  walletOutputs: readonly BitcoinTransactionOutput[];
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];

    for (const output of params.walletOutputs) {
      const quantity = normalizeBitcoinNativeQuantity(output.value, params.nativeDecimals);
      if (quantity.isZero()) {
        continue;
      }

      const componentId = yield* buildUtxoOutputComponentId(params.transactionId, output);
      refs.push(
        buildSourceComponentQuantityRef({
          assetId: params.assetId,
          componentId,
          componentKind: 'utxo_output',
          quantity,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        })
      );
    }

    return refs;
  });
}

function buildPrincipalComponentRefs(params: {
  assetId: string;
  nativeDecimals: number;
  sourceActivityFingerprint: string;
  transaction: BitcoinTransaction;
  walletNativeTotals: WalletNativeTotals;
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];

    if (params.walletNativeTotals.walletInputAmount.gt(0)) {
      refs.push(
        ...(yield* buildPrincipalInputComponentRefs({
          assetId: params.assetId,
          nativeDecimals: params.nativeDecimals,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          transactionId: params.transaction.id,
          walletInputs: params.walletNativeTotals.walletInputs,
        }))
      );
    }

    if (params.walletNativeTotals.walletOutputAmount.gt(0)) {
      refs.push(
        ...(yield* buildPrincipalOutputComponentRefs({
          assetId: params.assetId,
          nativeDecimals: params.nativeDecimals,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          transactionId: params.transaction.id,
          walletOutputs: params.walletNativeTotals.walletOutputs,
        }))
      );
    }

    if (refs.length === 0) {
      return yield* err(
        new Error(`Bitcoin v2 principal posting for transaction ${params.transaction.id} has no source component refs`)
      );
    }

    return refs;
  });
}

function buildPrincipalPosting(params: {
  assetRef: BitcoinNativeAssetRef;
  feeAmount: Decimal;
  nativeDecimals: number;
  sourceActivityFingerprint: string;
  transaction: BitcoinTransaction;
  walletNativeTotals: WalletNativeTotals;
  walletPaysNetworkFee: boolean;
}): Result<AccountingPostingDraft | undefined, Error> {
  const feeAdjustment = params.walletPaysNetworkFee ? params.feeAmount : new Decimal(0);
  const quantity = params.walletNativeTotals.walletOutputAmount
    .minus(params.walletNativeTotals.walletInputAmount)
    .plus(feeAdjustment);

  if (quantity.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const sourceComponentRefs = yield* buildPrincipalComponentRefs({
      assetId: params.assetRef.assetId,
      nativeDecimals: params.nativeDecimals,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      transaction: params.transaction,
      walletNativeTotals: params.walletNativeTotals,
    });

    return {
      postingStableKey: 'principal:native',
      assetId: params.assetRef.assetId,
      assetSymbol: params.assetRef.assetSymbol,
      quantity,
      role: 'principal',
      sourceComponentRefs,
    };
  });
}

function buildNetworkFeePosting(
  sourceActivityFingerprint: string,
  transaction: BitcoinTransaction,
  assetRef: BitcoinNativeAssetRef,
  feeAmount: Decimal,
  feeCurrency: Currency
): AccountingPostingDraft {
  return {
    postingStableKey: 'network_fee:native',
    assetId: assetRef.assetId,
    assetSymbol: feeCurrency,
    quantity: feeAmount.negated(),
    role: 'fee',
    settlement: 'on-chain',
    sourceComponentRefs: [
      buildSourceComponentQuantityRef({
        assetId: assetRef.assetId,
        componentId: `${transaction.id}:network_fee:native`,
        componentKind: 'network_fee',
        quantity: feeAmount,
        sourceActivityFingerprint,
      }),
    ],
  };
}

function buildOptionalNetworkFeePosting(
  sourceActivityFingerprint: string,
  transaction: BitcoinTransaction,
  chainConfig: BitcoinChainConfig,
  assetRef: BitcoinNativeAssetRef,
  walletPaysNetworkFee: boolean,
  feeAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  if (!walletPaysNetworkFee || feeAmount.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const feeCurrency = yield* parseCurrency(transaction.feeCurrency ?? chainConfig.nativeCurrency);
    return buildNetworkFeePosting(sourceActivityFingerprint, transaction, assetRef, feeAmount, feeCurrency);
  });
}

function buildBitcoinJournals(parts: BitcoinJournalAssemblyParts): AccountingJournalDraft[] {
  const journalDiagnostics = parts.diagnostics.length > 0 ? [...parts.diagnostics] : undefined;

  if (parts.principalPosting) {
    const postings = parts.feePosting ? [parts.principalPosting, parts.feePosting] : [parts.principalPosting];
    return [
      {
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: 'transfer',
        journalKind: 'transfer',
        postings,
        ...(journalDiagnostics ? { diagnostics: journalDiagnostics } : {}),
      },
    ];
  }

  if (parts.feePosting) {
    return [
      {
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: 'network_fee',
        journalKind: 'expense_only',
        postings: [parts.feePosting],
        ...(journalDiagnostics ? { diagnostics: journalDiagnostics } : {}),
      },
    ];
  }

  return [];
}

function isBitcoinMessageOutput(output: BitcoinTransactionOutput): boolean {
  const scriptType = output.scriptType?.toLowerCase();
  if (scriptType && ['null-data', 'nulldata', 'op_return', 'op-return'].includes(scriptType)) {
    return true;
  }

  return output.script?.trim().toLowerCase().startsWith('6a') === true;
}

function buildBitcoinDiagnostics(
  transaction: BitcoinTransaction,
  walletNativeTotals: WalletNativeTotals
): AccountingDiagnosticDraft[] {
  const diagnostics: AccountingDiagnosticDraft[] = [];
  const messageOutputCount = transaction.outputs.filter(isBitcoinMessageOutput).length;

  if (messageOutputCount > 0) {
    diagnostics.push({
      code: 'bitcoin_message_output',
      message: `Bitcoin transaction ${transaction.id} contains ${messageOutputCount} OP_RETURN/message output(s); message data is non-accounting evidence.`,
      severity: 'info',
    });
  }

  if (walletNativeTotals.walletInputs.length > 1 && walletNativeTotals.walletOutputs.length > 1) {
    diagnostics.push({
      code: 'bitcoin_many_to_many_utxo',
      message: `Bitcoin transaction ${transaction.id} has multiple wallet inputs and outputs; accounting is wallet-netted because output-level intent is ambiguous.`,
      severity: 'info',
    });
  }

  return diagnostics;
}

function computeBitcoinSourceActivityFingerprint(
  transaction: BitcoinTransaction,
  chainConfig: BitcoinChainConfig,
  context: BitcoinProcessorV2Context
): Result<string, Error> {
  return computeSourceActivityFingerprint({
    accountFingerprint: context.account.fingerprint,
    platformKey: chainConfig.chainName,
    platformKind: 'blockchain',
    blockchainTransactionHash: transaction.id,
  });
}

function resolveSourceActivityFromAddress(
  transaction: BitcoinTransaction,
  walletNativeTotals: WalletNativeTotals,
  walletAddresses: ReadonlySet<string>
): string | undefined {
  return (
    walletNativeTotals.walletInputs[0]?.address ??
    findFirstExternalAddress(transaction.inputs, walletAddresses) ??
    transaction.inputs[0]?.address
  );
}

function resolveSourceActivityToAddress(
  transaction: BitcoinTransaction,
  walletNativeTotals: WalletNativeTotals,
  walletAddresses: ReadonlySet<string>
): string | undefined {
  const externalOutputAddress = findFirstExternalAddress(transaction.outputs, walletAddresses);
  if (walletNativeTotals.walletInputs.length > 0 && externalOutputAddress !== undefined) {
    return externalOutputAddress;
  }

  return walletNativeTotals.walletOutputs[0]?.address ?? externalOutputAddress ?? transaction.outputs[0]?.address;
}

function buildBitcoinSourceActivityDraft(params: {
  chainConfig: BitcoinChainConfig;
  context: BitcoinProcessorV2Context;
  sourceActivityFingerprint: string;
  transaction: BitcoinTransaction;
  walletAddresses: ReadonlySet<string>;
  walletNativeTotals: WalletNativeTotals;
}): SourceActivityDraft {
  return {
    accountId: params.context.account.id,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
    platformKey: params.chainConfig.chainName,
    platformKind: 'blockchain',
    activityStatus: params.transaction.status,
    activityDatetime: new Date(params.transaction.timestamp).toISOString(),
    activityTimestampMs: params.transaction.timestamp,
    fromAddress: resolveSourceActivityFromAddress(
      params.transaction,
      params.walletNativeTotals,
      params.walletAddresses
    ),
    toAddress: resolveSourceActivityToAddress(params.transaction, params.walletNativeTotals, params.walletAddresses),
    blockchainName: params.chainConfig.chainName,
    ...(params.transaction.blockHeight === undefined ? {} : { blockchainBlockHeight: params.transaction.blockHeight }),
    blockchainTransactionHash: params.transaction.id,
    blockchainIsConfirmed: params.transaction.status === 'success',
  };
}

export function assembleBitcoinLedgerDraft(
  transaction: BitcoinTransaction,
  chainConfig: BitcoinChainConfig,
  context: BitcoinProcessorV2Context
): Result<BitcoinLedgerDraft, Error> {
  return resultDo(function* () {
    yield* validateBitcoinChainConfig(chainConfig);
    yield* validateBitcoinTransactionCurrency(transaction, chainConfig);
    const feeAmount = yield* validateBitcoinTransactionAmounts(transaction);
    const walletAddresses = yield* validateBitcoinProcessorV2Context(context);
    const sourceActivityFingerprint = yield* computeBitcoinSourceActivityFingerprint(transaction, chainConfig, context);
    const assetRef = yield* buildBitcoinNativeAssetRef(chainConfig);
    const walletNativeTotals = collectWalletNativeTotals(transaction, walletAddresses, chainConfig.nativeDecimals);
    yield* validateWalletScopeEffect(transaction, walletNativeTotals);
    const walletPaysNetworkFee = walletNativeTotals.walletInputs.length > 0;
    const feePosting = yield* buildOptionalNetworkFeePosting(
      sourceActivityFingerprint,
      transaction,
      chainConfig,
      assetRef,
      walletPaysNetworkFee,
      feeAmount
    );
    const principalPosting = yield* buildPrincipalPosting({
      assetRef,
      feeAmount,
      sourceActivityFingerprint,
      transaction,
      walletNativeTotals,
      walletPaysNetworkFee,
      nativeDecimals: chainConfig.nativeDecimals,
    });
    const diagnostics = buildBitcoinDiagnostics(transaction, walletNativeTotals);
    const journals = buildBitcoinJournals({
      diagnostics,
      feePosting,
      principalPosting,
      sourceActivityFingerprint,
    });
    const sourceActivity = buildBitcoinSourceActivityDraft({
      chainConfig,
      context,
      sourceActivityFingerprint,
      transaction,
      walletAddresses,
      walletNativeTotals,
    });

    return {
      sourceActivity,
      journals,
    };
  });
}
