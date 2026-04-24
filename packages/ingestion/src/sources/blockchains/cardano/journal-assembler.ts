import type {
  CardanoAssetAmount,
  CardanoTransaction,
  CardanoTransactionInput,
  CardanoTransactionOutput,
} from '@exitbook/blockchain-providers/cardano';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
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
  type AccountingJournalDraft,
  type AccountingPostingDraft,
  type SourceActivityDraft,
  type SourceComponentQuantityRef,
} from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import { normalizeCardanoAmount, parseCardanoAssetUnit } from './processor-utils.js';

export interface CardanoProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface CardanoProcessorV2Context {
  account: CardanoProcessorV2AccountContext;
  walletAddresses: readonly string[];
}

export interface CardanoLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

interface CardanoAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

interface WalletAssetAmount {
  amount: Decimal;
  symbol?: string | undefined;
  unit: string;
}

interface WalletAssetTotals {
  inputsByUnit: Map<string, WalletAssetAmount>;
  outputsByUnit: Map<string, WalletAssetAmount>;
  ownedInputs: CardanoTransactionInput[];
  ownedOutputs: CardanoTransactionOutput[];
}

type CardanoWithdrawal = NonNullable<CardanoTransaction['withdrawals']>[number];

function normalizeWalletAddressSet(walletAddresses: readonly string[]): Result<ReadonlySet<string>, Error> {
  const normalizedAddresses = walletAddresses.map((address) => address.trim()).filter((address) => address.length > 0);

  if (normalizedAddresses.length === 0) {
    return err(new Error('Cardano v2 wallet address scope must contain at least one address'));
  }

  return ok(new Set(normalizedAddresses));
}

function validateCardanoProcessorV2Context(context: CardanoProcessorV2Context): Result<ReadonlySet<string>, Error> {
  if (!Number.isInteger(context.account.id) || context.account.id <= 0) {
    return err(new Error(`Cardano v2 account id must be a positive integer, got ${context.account.id}`));
  }

  if (context.account.fingerprint.trim() === '') {
    return err(new Error('Cardano v2 account fingerprint must not be empty'));
  }

  return normalizeWalletAddressSet(context.walletAddresses);
}

function isWalletAddress(address: string, walletAddresses: ReadonlySet<string>): boolean {
  return walletAddresses.has(address);
}

function buildCardanoAssetRefFromUnit(unit: string, symbol?: string): Result<CardanoAssetRef, Error> {
  return resultDo(function* () {
    const isNativeAda = unit === 'lovelace';
    const assetId = isNativeAda
      ? yield* buildBlockchainNativeAssetId('cardano')
      : yield* buildBlockchainTokenAssetId('cardano', unit);
    const defaultSymbol = isNativeAda ? 'ADA' : unit;
    const assetSymbol = yield* parseCurrency(symbol ?? defaultSymbol);

    return {
      assetId,
      assetSymbol,
    };
  });
}

function normalizeCardanoAssetQuantity(assetAmount: CardanoAssetAmount): Decimal {
  const { isAda } = parseCardanoAssetUnit(assetAmount.unit);
  const decimals = isAda ? 6 : assetAmount.decimals;
  return parseDecimal(normalizeCardanoAmount(assetAmount.quantity, decimals));
}

function addAssetAmount(
  amountsByUnit: Map<string, WalletAssetAmount>,
  assetAmount: CardanoAssetAmount
): Result<void, Error> {
  const quantity = normalizeCardanoAssetQuantity(assetAmount);
  if (quantity.isZero()) {
    return ok(undefined);
  }

  const existing = amountsByUnit.get(assetAmount.unit);
  if (!existing) {
    amountsByUnit.set(assetAmount.unit, {
      amount: quantity,
      symbol: assetAmount.symbol,
      unit: assetAmount.unit,
    });
    return ok(undefined);
  }

  const hasConflictingSymbol =
    existing.symbol !== undefined && assetAmount.symbol !== undefined && existing.symbol !== assetAmount.symbol;
  if (hasConflictingSymbol) {
    return err(
      new Error(
        `Cardano v2 asset unit ${assetAmount.unit} has conflicting symbols: ${existing.symbol} vs ${assetAmount.symbol}`
      )
    );
  }

  amountsByUnit.set(assetAmount.unit, {
    ...existing,
    amount: existing.amount.plus(quantity),
    symbol: existing.symbol ?? assetAmount.symbol,
  });

  return ok(undefined);
}

function collectWalletAssetTotals(
  transaction: CardanoTransaction,
  walletAddresses: ReadonlySet<string>
): Result<WalletAssetTotals, Error> {
  return resultDo(function* () {
    const inputsByUnit = new Map<string, WalletAssetAmount>();
    const outputsByUnit = new Map<string, WalletAssetAmount>();
    const ownedInputs = transaction.inputs.filter((input) => isWalletAddress(input.address, walletAddresses));
    const ownedOutputs = transaction.outputs.filter((output) => isWalletAddress(output.address, walletAddresses));

    for (const input of ownedInputs) {
      for (const assetAmount of input.amounts) {
        yield* addAssetAmount(inputsByUnit, assetAmount);
      }
    }

    for (const output of ownedOutputs) {
      for (const assetAmount of output.amounts) {
        yield* addAssetAmount(outputsByUnit, assetAmount);
      }
    }

    return {
      inputsByUnit,
      outputsByUnit,
      ownedInputs,
      ownedOutputs,
    };
  });
}

function buildPostingComponentRef(
  sourceActivityFingerprint: string,
  componentKind: 'network_fee' | 'staking_reward' | 'utxo_input' | 'utxo_output',
  componentId: string,
  assetId: string,
  quantity: Decimal,
  occurrence?: number
): SourceComponentQuantityRef {
  return {
    component: {
      sourceActivityFingerprint,
      componentKind,
      componentId,
      occurrence,
      assetId,
    },
    quantity: quantity.abs(),
  };
}

function buildUtxoInputComponentId(input: CardanoTransactionInput): string {
  return `utxo:${input.txHash}:${input.outputIndex}`;
}

function buildUtxoOutputComponentId(transactionId: string, output: CardanoTransactionOutput): string {
  return `utxo:${transactionId}:${output.outputIndex}`;
}

function findFirstExternalAddress(
  entries: readonly { address: string }[],
  walletAddresses: ReadonlySet<string>
): string | undefined {
  return entries.find((entry) => !isWalletAddress(entry.address, walletAddresses))?.address;
}

function buildPrincipalInputComponentRefs(
  ownedInputs: readonly CardanoTransactionInput[],
  sourceActivityFingerprint: string,
  unit: string
): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(unit);
    const refs: SourceComponentQuantityRef[] = [];

    for (const input of ownedInputs) {
      for (const assetAmount of input.amounts) {
        if (assetAmount.unit !== unit) {
          continue;
        }

        const quantity = normalizeCardanoAssetQuantity(assetAmount);
        if (quantity.isZero()) {
          continue;
        }

        refs.push(
          buildPostingComponentRef(
            sourceActivityFingerprint,
            'utxo_input',
            buildUtxoInputComponentId(input),
            assetRef.assetId,
            quantity
          )
        );
      }
    }

    return refs;
  });
}

function buildPrincipalOutputComponentRefs(
  transaction: CardanoTransaction,
  ownedOutputs: readonly CardanoTransactionOutput[],
  sourceActivityFingerprint: string,
  unit: string
): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(unit);
    const refs: SourceComponentQuantityRef[] = [];

    for (const output of ownedOutputs) {
      for (const assetAmount of output.amounts) {
        if (assetAmount.unit !== unit) {
          continue;
        }

        const quantity = normalizeCardanoAssetQuantity(assetAmount);
        if (quantity.isZero()) {
          continue;
        }

        refs.push(
          buildPostingComponentRef(
            sourceActivityFingerprint,
            'utxo_output',
            buildUtxoOutputComponentId(transaction.id, output),
            assetRef.assetId,
            quantity
          )
        );
      }
    }

    return refs;
  });
}

function buildPrincipalComponentRefs(params: {
  inputAmount: Decimal;
  outputAmount: Decimal;
  ownedInputs: readonly CardanoTransactionInput[];
  ownedOutputs: readonly CardanoTransactionOutput[];
  sourceActivityFingerprint: string;
  transaction: CardanoTransaction;
  unit: string;
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];

    if (params.inputAmount.gt(0)) {
      refs.push(
        ...(yield* buildPrincipalInputComponentRefs(params.ownedInputs, params.sourceActivityFingerprint, params.unit))
      );
    }

    if (params.outputAmount.gt(0)) {
      refs.push(
        ...(yield* buildPrincipalOutputComponentRefs(
          params.transaction,
          params.ownedOutputs,
          params.sourceActivityFingerprint,
          params.unit
        ))
      );
    }

    if (refs.length === 0) {
      yield* err(
        new Error(
          `Cardano v2 principal posting for transaction ${params.transaction.id} unit ${params.unit} has no source component refs`
        )
      );
    }

    return refs;
  });
}

function buildPrincipalPosting(params: {
  assetAmount: WalletAssetAmount;
  inputAmount: Decimal;
  outputAmount: Decimal;
  ownedInputs: readonly CardanoTransactionInput[];
  ownedOutputs: readonly CardanoTransactionOutput[];
  quantity: Decimal;
  sourceActivityFingerprint: string;
  transaction: CardanoTransaction;
}): Result<AccountingPostingDraft | undefined, Error> {
  if (params.quantity.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(params.assetAmount.unit, params.assetAmount.symbol);
    const sourceComponentRefs = yield* buildPrincipalComponentRefs({
      inputAmount: params.inputAmount,
      outputAmount: params.outputAmount,
      ownedInputs: params.ownedInputs,
      ownedOutputs: params.ownedOutputs,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      transaction: params.transaction,
      unit: params.assetAmount.unit,
    });

    return {
      postingStableKey: `principal:${params.assetAmount.unit}`,
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity: params.quantity,
      role: 'principal',
      sourceComponentRefs,
    };
  });
}

function buildNetworkFeePosting(
  sourceActivityFingerprint: string,
  transactionId: string,
  feeAmount: Decimal,
  feeCurrency: Currency
): Result<AccountingPostingDraft, Error> {
  return resultDo(function* () {
    const feeAssetId = yield* buildBlockchainNativeAssetId('cardano');

    return {
      postingStableKey: 'network_fee:lovelace',
      assetId: feeAssetId,
      assetSymbol: feeCurrency,
      quantity: feeAmount.negated(),
      role: 'fee',
      settlement: 'on-chain',
      sourceComponentRefs: [
        buildPostingComponentRef(
          sourceActivityFingerprint,
          'network_fee',
          `${transactionId}:network_fee:lovelace`,
          feeAssetId,
          feeAmount
        ),
      ],
    };
  });
}

function buildStakingRewardComponentRef(
  sourceActivityFingerprint: string,
  withdrawal: CardanoWithdrawal,
  withdrawalIndex: number,
  assetId: string
): SourceComponentQuantityRef {
  return buildPostingComponentRef(
    sourceActivityFingerprint,
    'staking_reward',
    `withdrawal:${withdrawal.address}`,
    assetId,
    parseDecimal(withdrawal.amount),
    withdrawalIndex + 1
  );
}

function buildPrincipalPostings(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  walletAssetTotals: WalletAssetTotals,
  walletPaysNetworkFee: boolean,
  feeAmount: Decimal,
  walletWithdrawalAmount: Decimal
): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const principalPostings: AccountingPostingDraft[] = [];
    const units = new Set([...walletAssetTotals.inputsByUnit.keys(), ...walletAssetTotals.outputsByUnit.keys()]);

    for (const unit of [...units].sort()) {
      const inputAmount = walletAssetTotals.inputsByUnit.get(unit)?.amount ?? new Decimal(0);
      const outputAmount = walletAssetTotals.outputsByUnit.get(unit)?.amount ?? new Decimal(0);
      const feeAdjustment = walletPaysNetworkFee && unit === 'lovelace' ? feeAmount : new Decimal(0);
      const rewardFundingAdjustment =
        walletPaysNetworkFee && unit === 'lovelace' ? walletWithdrawalAmount : new Decimal(0);
      const quantity = outputAmount.minus(inputAmount).plus(feeAdjustment).minus(rewardFundingAdjustment);
      const assetAmount = walletAssetTotals.outputsByUnit.get(unit) ?? walletAssetTotals.inputsByUnit.get(unit);

      if (!assetAmount) {
        continue;
      }

      const posting = yield* buildPrincipalPosting({
        assetAmount,
        inputAmount,
        outputAmount,
        quantity,
        ownedInputs: walletAssetTotals.ownedInputs,
        ownedOutputs: walletAssetTotals.ownedOutputs,
        sourceActivityFingerprint,
        transaction,
      });

      if (posting) {
        principalPostings.push(posting);
      }
    }

    return principalPostings;
  });
}

function buildStakingRewardPosting(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  walletPaysNetworkFee: boolean,
  walletWithdrawalAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  return resultDo(function* () {
    const withdrawals = transaction.withdrawals ?? [];
    if (withdrawals.length === 0 || !walletPaysNetworkFee || walletWithdrawalAmount.isZero()) {
      return undefined;
    }

    const assetRef = yield* buildCardanoAssetRefFromUnit('lovelace', 'ADA');
    const sourceComponentRefs = withdrawals
      .map((withdrawal, index) =>
        buildStakingRewardComponentRef(sourceActivityFingerprint, withdrawal, index, assetRef.assetId)
      )
      .filter((ref) => !ref.quantity.isZero());

    if (sourceComponentRefs.length === 0) {
      return yield* err(
        new Error(`Cardano v2 staking reward posting for transaction ${transaction.id} has no withdrawal refs`)
      );
    }

    return {
      postingStableKey: 'staking_reward:lovelace',
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity: walletWithdrawalAmount,
      role: 'staking_reward',
      sourceComponentRefs,
    };
  });
}

function sumWalletWithdrawalAmount(transaction: CardanoTransaction, walletPaysNetworkFee: boolean): Decimal {
  if (!walletPaysNetworkFee) {
    return new Decimal(0);
  }

  return (transaction.withdrawals ?? []).reduce(
    (sum, withdrawal) => sum.plus(parseDecimal(withdrawal.amount)),
    new Decimal(0)
  );
}

function buildCardanoJournals(
  sourceActivityFingerprint: string,
  principalPostings: AccountingPostingDraft[],
  rewardPosting: AccountingPostingDraft | undefined,
  feePosting: AccountingPostingDraft | undefined
): AccountingJournalDraft[] {
  const journals: AccountingJournalDraft[] = [];
  let pendingFeePosting = feePosting;

  if (principalPostings.length > 0) {
    const postings = pendingFeePosting ? [...principalPostings, pendingFeePosting] : principalPostings;
    pendingFeePosting = undefined;

    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'transfer',
      journalKind: 'transfer',
      postings,
    });
  }

  if (rewardPosting) {
    const postings = pendingFeePosting ? [rewardPosting, pendingFeePosting] : [rewardPosting];
    pendingFeePosting = undefined;

    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'staking_reward',
      journalKind: 'staking_reward',
      postings,
    });
  }

  if (pendingFeePosting) {
    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'network_fee',
      journalKind: 'expense_only',
      postings: [pendingFeePosting],
    });
  }

  return journals;
}

function computeCardanoSourceActivityFingerprint(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<string, Error> {
  return computeSourceActivityFingerprint({
    accountFingerprint: context.account.fingerprint,
    platformKey: 'cardano',
    platformKind: 'blockchain',
    blockchainTransactionHash: transaction.id,
  });
}

function buildOptionalNetworkFeePosting(
  sourceActivityFingerprint: string,
  transaction: CardanoTransaction,
  walletPaysNetworkFee: boolean,
  feeAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  if (!walletPaysNetworkFee || feeAmount.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const feeCurrencyCode = transaction.feeCurrency?.trim();
    if (!feeCurrencyCode) {
      return yield* err(new Error(`Cardano v2 fee posting for transaction ${transaction.id} is missing fee currency`));
    }

    const feeCurrency = yield* parseCurrency(feeCurrencyCode);
    return yield* buildNetworkFeePosting(sourceActivityFingerprint, transaction.id, feeAmount, feeCurrency);
  });
}

function resolveSourceActivityFromAddress(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals,
  walletAddresses: ReadonlySet<string>
): string | undefined {
  return (
    walletAssetTotals.ownedInputs[0]?.address ??
    findFirstExternalAddress(transaction.inputs, walletAddresses) ??
    transaction.inputs[0]?.address
  );
}

function resolveSourceActivityToAddress(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals,
  walletAddresses: ReadonlySet<string>
): string | undefined {
  const externalOutputAddress = findFirstExternalAddress(transaction.outputs, walletAddresses);
  if (walletAssetTotals.ownedInputs.length > 0 && externalOutputAddress !== undefined) {
    return externalOutputAddress;
  }

  return walletAssetTotals.ownedOutputs[0]?.address ?? externalOutputAddress ?? transaction.outputs[0]?.address;
}

function buildCardanoSourceActivityDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context,
  sourceActivityFingerprint: string,
  walletAssetTotals: WalletAssetTotals,
  walletAddresses: ReadonlySet<string>
): SourceActivityDraft {
  return {
    accountId: context.account.id,
    sourceActivityFingerprint,
    platformKey: 'cardano',
    platformKind: 'blockchain',
    activityStatus: transaction.status,
    activityDatetime: new Date(transaction.timestamp).toISOString(),
    activityTimestampMs: transaction.timestamp,
    fromAddress: resolveSourceActivityFromAddress(transaction, walletAssetTotals, walletAddresses),
    toAddress: resolveSourceActivityToAddress(transaction, walletAssetTotals, walletAddresses),
    blockchainName: 'cardano',
    blockchainBlockHeight: transaction.blockHeight,
    blockchainTransactionHash: transaction.id,
    blockchainIsConfirmed: transaction.status === 'success',
  };
}

export function assembleCardanoLedgerDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<CardanoLedgerDraft, Error> {
  return resultDo(function* () {
    const walletAddresses = yield* validateCardanoProcessorV2Context(context);
    const sourceActivityFingerprint = yield* computeCardanoSourceActivityFingerprint(transaction, context);
    const walletAssetTotals = yield* collectWalletAssetTotals(transaction, walletAddresses);
    const feeAmount = parseDecimal(transaction.feeAmount ?? '0');
    const walletPaysNetworkFee = walletAssetTotals.ownedInputs.length > 0;
    const walletWithdrawalAmount = sumWalletWithdrawalAmount(transaction, walletPaysNetworkFee);
    const feePosting = yield* buildOptionalNetworkFeePosting(
      sourceActivityFingerprint,
      transaction,
      walletPaysNetworkFee,
      feeAmount
    );
    const principalPostings = yield* buildPrincipalPostings(
      transaction,
      sourceActivityFingerprint,
      walletAssetTotals,
      walletPaysNetworkFee,
      feeAmount,
      walletWithdrawalAmount
    );
    const rewardPosting = yield* buildStakingRewardPosting(
      transaction,
      sourceActivityFingerprint,
      walletPaysNetworkFee,
      walletWithdrawalAmount
    );
    const journals = buildCardanoJournals(sourceActivityFingerprint, principalPostings, rewardPosting, feePosting);
    const sourceActivity = buildCardanoSourceActivityDraft(
      transaction,
      context,
      sourceActivityFingerprint,
      walletAssetTotals,
      walletAddresses
    );

    return {
      sourceActivity,
      journals,
    };
  });
}
