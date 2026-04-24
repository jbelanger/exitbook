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
  resultDo,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import {
  computeSourceActivityFingerprint,
  type AccountingDiagnosticDraft,
  type AccountingJournalDraft,
  type AccountingPostingDraft,
  type AccountingPostingRole,
  type AccountingSourceComponentKind,
  type SourceActivityDraft,
  type SourceComponentQuantityRef,
} from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import {
  buildSourceComponentQuantityRef,
  parseLedgerDecimalAmount,
  validateLedgerProcessorAccountContext,
} from '../shared/ledger-assembler-utils.js';

import { normalizeCardanoAddress } from './address-utils.js';
import { parseCardanoAssetUnit } from './processor-utils.js';

export interface CardanoProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface CardanoProcessorV2Context {
  account: CardanoProcessorV2AccountContext;
  stakeAddresses?: readonly string[] | undefined;
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
  walletInputs: CardanoTransactionInput[];
  walletOutputs: CardanoTransactionOutput[];
}

interface CardanoWalletScope {
  stakeAddresses?: ReadonlySet<string> | undefined;
  walletAddresses: ReadonlySet<string>;
}

type CardanoWalletDeltaJournalKind = 'protocol_event' | 'transfer';

interface CardanoJournalAssemblyParts {
  diagnostics: readonly AccountingDiagnosticDraft[];
  feePosting: AccountingPostingDraft | undefined;
  hasProtocolEvidence: boolean;
  protocolEventPostings: readonly AccountingPostingDraft[];
  protocolEventStableKey: string;
  rewardPosting: AccountingPostingDraft | undefined;
  sourceActivityFingerprint: string;
  walletDeltaJournalKind: CardanoWalletDeltaJournalKind;
  walletDeltaPostings: readonly AccountingPostingDraft[];
}

interface CardanoFeeOnlyJournalDescriptor {
  journalKind: 'expense_only' | 'protocol_event';
  journalStableKey: string;
}

interface ValidatedCardanoAmounts {
  protocolDepositDeltaAmount: Decimal;
  feeAmount: Decimal;
  treasuryDonationAmount: Decimal;
  withdrawalAmounts: readonly Decimal[];
}

type CardanoWithdrawal = NonNullable<CardanoTransaction['withdrawals']>[number];
type CardanoStakeCertificate = NonNullable<CardanoTransaction['stakeCertificates']>[number];

function normalizeAddressSet(params: {
  addresses: readonly string[] | undefined;
  allowEmpty: boolean;
  label: string;
}): Result<ReadonlySet<string>, Error> {
  return resultDo(function* () {
    const normalizedAddresses: string[] = [];
    for (const address of params.addresses ?? []) {
      const trimmedAddress = address.trim();
      if (trimmedAddress.length === 0) {
        continue;
      }

      normalizedAddresses.push(yield* normalizeCardanoAddress(trimmedAddress));
    }

    if (normalizedAddresses.length === 0 && !params.allowEmpty) {
      return yield* err(new Error(`Cardano v2 ${params.label} scope must contain at least one address`));
    }

    return new Set(normalizedAddresses);
  });
}

function normalizeWalletAddressSet(walletAddresses: readonly string[]): Result<ReadonlySet<string>, Error> {
  return normalizeAddressSet({
    addresses: walletAddresses,
    allowEmpty: false,
    label: 'wallet address',
  });
}

function validateCardanoProcessorV2Context(context: CardanoProcessorV2Context): Result<CardanoWalletScope, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'Cardano v2');
    const walletAddresses = yield* normalizeWalletAddressSet(context.walletAddresses);
    let stakeAddresses: ReadonlySet<string> | undefined;
    if (context.stakeAddresses !== undefined) {
      stakeAddresses = yield* normalizeAddressSet({
        addresses: context.stakeAddresses,
        allowEmpty: false,
        label: 'stake address',
      });
    }

    return {
      stakeAddresses,
      walletAddresses,
    };
  });
}

function isWalletAddress(address: string, walletAddresses: ReadonlySet<string>): boolean {
  return walletAddresses.has(address);
}

function isWalletStakeAddress(
  stakeAddress: string,
  walletScope: CardanoWalletScope,
  walletPaysNetworkFee: boolean
): boolean {
  if (walletScope.stakeAddresses !== undefined) {
    return walletScope.stakeAddresses.has(stakeAddress);
  }

  return walletPaysNetworkFee;
}

function isEffectiveCardanoInput(
  transactionStatus: CardanoTransaction['status'],
  hasCollateralInputs: boolean,
  input: CardanoTransactionInput
): boolean {
  if (input.isReference === true) {
    return false;
  }

  if (transactionStatus === 'failed' && hasCollateralInputs) {
    return input.isCollateral === true;
  }

  if (transactionStatus !== 'failed' && input.isCollateral === true) {
    return false;
  }

  return true;
}

function isEffectiveCardanoOutput(
  transactionStatus: CardanoTransaction['status'],
  hasCollateralOutputs: boolean,
  output: CardanoTransactionOutput
): boolean {
  if (transactionStatus === 'failed' && hasCollateralOutputs) {
    return output.isCollateral === true;
  }

  return true;
}

function parseCardanoTransactionAmount(params: {
  allowMissing?: boolean | undefined;
  label: string;
  transactionId: string;
  value: string | undefined;
}): Result<Decimal, Error> {
  return parseLedgerDecimalAmount({
    ...params,
    processorLabel: 'Cardano v2',
  });
}

function validateCardanoAssetDecimals(params: {
  assetUnit: string;
  decimals: number | undefined;
  label: string;
  transactionId: string;
}): Result<number | undefined, Error> {
  if (params.decimals === undefined) {
    return ok(undefined);
  }

  if (!Number.isInteger(params.decimals) || params.decimals < 0) {
    return err(
      new Error(
        `Cardano v2 transaction ${params.transactionId} ${params.label} asset ${params.assetUnit} decimals must be a non-negative integer`
      )
    );
  }

  return ok(params.decimals);
}

function normalizeCardanoAssetQuantity(params: {
  assetAmount: CardanoAssetAmount;
  label: string;
  transactionId: string;
}): Result<Decimal, Error> {
  return resultDo(function* () {
    const amount = yield* parseCardanoTransactionAmount({
      label: params.label,
      transactionId: params.transactionId,
      value: params.assetAmount.quantity,
    });
    if (amount.isNegative()) {
      return yield* err(
        new Error(`Cardano v2 transaction ${params.transactionId} ${params.label} amount must not be negative`)
      );
    }

    const decimals = yield* validateCardanoAssetDecimals({
      assetUnit: params.assetAmount.unit,
      decimals: params.assetAmount.decimals,
      label: params.label,
      transactionId: params.transactionId,
    });
    const { isAda } = parseCardanoAssetUnit(params.assetAmount.unit);
    const normalizedDecimals = isAda ? 6 : decimals;
    if (normalizedDecimals === undefined || normalizedDecimals === 0) {
      return amount;
    }

    return amount.dividedBy(new Decimal(10).pow(normalizedDecimals));
  });
}

function validateCardanoTransactionAmounts(transaction: CardanoTransaction): Result<ValidatedCardanoAmounts, Error> {
  return resultDo(function* () {
    for (const input of transaction.inputs) {
      for (const assetAmount of input.amounts) {
        yield* normalizeCardanoAssetQuantity({
          assetAmount,
          label: 'input',
          transactionId: transaction.id,
        });
      }
    }

    for (const output of transaction.outputs) {
      for (const assetAmount of output.amounts) {
        yield* normalizeCardanoAssetQuantity({
          assetAmount,
          label: 'output',
          transactionId: transaction.id,
        });
      }
    }

    const withdrawalAmounts: Decimal[] = [];
    for (const withdrawal of transaction.withdrawals ?? []) {
      const amount = yield* parseCardanoTransactionAmount({
        label: 'withdrawal',
        transactionId: transaction.id,
        value: withdrawal.amount,
      });
      if (amount.isNegative()) {
        return yield* err(new Error(`Cardano v2 transaction ${transaction.id} withdrawal amount must not be negative`));
      }

      withdrawalAmounts.push(amount);
    }

    for (const certificate of transaction.mirCertificates ?? []) {
      const amount = yield* parseCardanoTransactionAmount({
        label: 'MIR certificate',
        transactionId: transaction.id,
        value: certificate.amount,
      });
      if (amount.isNegative()) {
        return yield* err(
          new Error(`Cardano v2 transaction ${transaction.id} MIR certificate amount must not be negative`)
        );
      }
    }

    const protocolDepositDeltaAmount = yield* parseCardanoTransactionAmount({
      allowMissing: true,
      label: 'protocol deposit delta',
      transactionId: transaction.id,
      value: transaction.protocolDepositDeltaAmount,
    });
    const treasuryDonationAmount = yield* parseCardanoTransactionAmount({
      allowMissing: true,
      label: 'treasury donation',
      transactionId: transaction.id,
      value: transaction.treasuryDonationAmount,
    });
    if (treasuryDonationAmount.isNegative()) {
      return yield* err(
        new Error(`Cardano v2 transaction ${transaction.id} treasury donation amount must not be negative`)
      );
    }

    const feeAmount = yield* parseCardanoTransactionAmount({
      allowMissing: true,
      label: 'fee',
      transactionId: transaction.id,
      value: transaction.feeAmount,
    });
    if (feeAmount.isNegative()) {
      return yield* err(new Error(`Cardano v2 transaction ${transaction.id} fee amount must not be negative`));
    }

    return {
      protocolDepositDeltaAmount,
      feeAmount,
      treasuryDonationAmount,
      withdrawalAmounts,
    };
  });
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

function addAssetAmount(
  amountsByUnit: Map<string, WalletAssetAmount>,
  assetAmount: CardanoAssetAmount,
  label: 'input' | 'output',
  transactionId: string
): Result<void, Error> {
  return resultDo(function* () {
    const quantity = yield* normalizeCardanoAssetQuantity({ assetAmount, label, transactionId });
    if (quantity.isZero()) {
      return undefined;
    }

    const existing = amountsByUnit.get(assetAmount.unit);
    if (!existing) {
      amountsByUnit.set(assetAmount.unit, {
        amount: quantity,
        symbol: assetAmount.symbol,
        unit: assetAmount.unit,
      });
      return undefined;
    }

    const hasConflictingSymbol =
      existing.symbol !== undefined && assetAmount.symbol !== undefined && existing.symbol !== assetAmount.symbol;
    if (hasConflictingSymbol) {
      return yield* err(
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

    return undefined;
  });
}

function collectWalletAssetTotals(
  transaction: CardanoTransaction,
  walletAddresses: ReadonlySet<string>
): Result<WalletAssetTotals, Error> {
  return resultDo(function* () {
    const inputsByUnit = new Map<string, WalletAssetAmount>();
    const outputsByUnit = new Map<string, WalletAssetAmount>();
    const hasCollateralInputs = transaction.inputs.some((input) => input.isCollateral === true);
    const hasCollateralOutputs = transaction.outputs.some((output) => output.isCollateral === true);
    const effectiveInputs = transaction.inputs.filter((input) =>
      isEffectiveCardanoInput(transaction.status, hasCollateralInputs, input)
    );
    const effectiveOutputs = transaction.outputs.filter((output) =>
      isEffectiveCardanoOutput(transaction.status, hasCollateralOutputs, output)
    );
    const walletInputs = effectiveInputs.filter((input) => isWalletAddress(input.address, walletAddresses));
    const walletOutputs = effectiveOutputs.filter((output) => isWalletAddress(output.address, walletAddresses));

    for (const input of walletInputs) {
      for (const assetAmount of input.amounts) {
        yield* addAssetAmount(inputsByUnit, assetAmount, 'input', transaction.id);
      }
    }

    for (const output of walletOutputs) {
      for (const assetAmount of output.amounts) {
        yield* addAssetAmount(outputsByUnit, assetAmount, 'output', transaction.id);
      }
    }

    return {
      inputsByUnit,
      outputsByUnit,
      walletInputs,
      walletOutputs,
    };
  });
}

function validateWalletScopeEffect(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals
): Result<void, Error> {
  if (walletAssetTotals.inputsByUnit.size === 0 && walletAssetTotals.outputsByUnit.size === 0) {
    return err(new Error(`Cardano v2 transaction ${transaction.id} has no effect for the wallet address scope`));
  }

  return ok(undefined);
}

function buildPostingComponentRef(
  sourceActivityFingerprint: string,
  componentKind: AccountingSourceComponentKind,
  componentId: string,
  assetId: string,
  quantity: Decimal,
  occurrence?: number
): SourceComponentQuantityRef {
  return buildSourceComponentQuantityRef({
    assetId,
    componentId,
    componentKind,
    occurrence,
    quantity,
    sourceActivityFingerprint,
  });
}

function buildUtxoInputComponentId(input: CardanoTransactionInput): string {
  return `utxo:${input.txHash}:${input.outputIndex}`;
}

function buildUtxoOutputComponentId(transactionId: string, output: CardanoTransactionOutput): string {
  return `utxo:${transactionId}:${output.outputIndex}`;
}

function resolveCardanoInputComponentKind(input: CardanoTransactionInput): AccountingSourceComponentKind {
  return input.isCollateral === true ? 'cardano_collateral_input' : 'utxo_input';
}

function resolveCardanoOutputComponentKind(output: CardanoTransactionOutput): AccountingSourceComponentKind {
  return output.isCollateral === true ? 'cardano_collateral_return' : 'utxo_output';
}

function findFirstExternalAddress(
  entries: readonly { address: string }[],
  walletAddresses: ReadonlySet<string>
): string | undefined {
  return entries.find((entry) => !isWalletAddress(entry.address, walletAddresses))?.address;
}

function buildWalletDeltaInputComponentRefs(params: {
  sourceActivityFingerprint: string;
  transactionId: string;
  unit: string;
  walletInputs: readonly CardanoTransactionInput[];
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(params.unit);
    const refs: SourceComponentQuantityRef[] = [];

    for (const input of params.walletInputs) {
      for (const assetAmount of input.amounts) {
        if (assetAmount.unit !== params.unit) {
          continue;
        }

        const quantity = yield* normalizeCardanoAssetQuantity({
          assetAmount,
          label: 'input',
          transactionId: params.transactionId,
        });
        if (quantity.isZero()) {
          continue;
        }

        refs.push(
          buildPostingComponentRef(
            params.sourceActivityFingerprint,
            resolveCardanoInputComponentKind(input),
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

function buildWalletDeltaOutputComponentRefs(params: {
  sourceActivityFingerprint: string;
  transaction: CardanoTransaction;
  unit: string;
  walletOutputs: readonly CardanoTransactionOutput[];
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(params.unit);
    const refs: SourceComponentQuantityRef[] = [];

    for (const output of params.walletOutputs) {
      for (const assetAmount of output.amounts) {
        if (assetAmount.unit !== params.unit) {
          continue;
        }

        const quantity = yield* normalizeCardanoAssetQuantity({
          assetAmount,
          label: 'output',
          transactionId: params.transaction.id,
        });
        if (quantity.isZero()) {
          continue;
        }

        refs.push(
          buildPostingComponentRef(
            params.sourceActivityFingerprint,
            resolveCardanoOutputComponentKind(output),
            buildUtxoOutputComponentId(params.transaction.id, output),
            assetRef.assetId,
            quantity
          )
        );
      }
    }

    return refs;
  });
}

function buildWalletDeltaComponentRefs(params: {
  sourceActivityFingerprint: string;
  transaction: CardanoTransaction;
  unit: string;
  walletInputAmount: Decimal;
  walletInputs: readonly CardanoTransactionInput[];
  walletOutputAmount: Decimal;
  walletOutputs: readonly CardanoTransactionOutput[];
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];

    if (params.walletInputAmount.gt(0)) {
      refs.push(
        ...(yield* buildWalletDeltaInputComponentRefs({
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          transactionId: params.transaction.id,
          unit: params.unit,
          walletInputs: params.walletInputs,
        }))
      );
    }

    if (params.walletOutputAmount.gt(0)) {
      refs.push(
        ...(yield* buildWalletDeltaOutputComponentRefs({
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          transaction: params.transaction,
          unit: params.unit,
          walletOutputs: params.walletOutputs,
        }))
      );
    }

    if (refs.length === 0) {
      yield* err(
        new Error(
          `Cardano v2 wallet delta posting for transaction ${params.transaction.id} unit ${params.unit} has no source component refs`
        )
      );
    }

    return refs;
  });
}

function buildWalletDeltaPosting(params: {
  assetAmount: WalletAssetAmount;
  quantity: Decimal;
  role: AccountingPostingRole;
  sourceActivityFingerprint: string;
  transaction: CardanoTransaction;
  walletInputAmount: Decimal;
  walletInputs: readonly CardanoTransactionInput[];
  walletOutputAmount: Decimal;
  walletOutputs: readonly CardanoTransactionOutput[];
}): Result<AccountingPostingDraft | undefined, Error> {
  if (params.quantity.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(params.assetAmount.unit, params.assetAmount.symbol);
    const sourceComponentRefs = yield* buildWalletDeltaComponentRefs({
      walletInputAmount: params.walletInputAmount,
      walletOutputAmount: params.walletOutputAmount,
      walletInputs: params.walletInputs,
      walletOutputs: params.walletOutputs,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      transaction: params.transaction,
      unit: params.assetAmount.unit,
    });

    return {
      postingStableKey: `wallet_delta:${params.assetAmount.unit}`,
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity: params.quantity,
      role: params.role,
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
  assetId: string,
  withdrawalAmount: Decimal
): SourceComponentQuantityRef {
  return buildPostingComponentRef(
    sourceActivityFingerprint,
    'staking_reward',
    `withdrawal:${withdrawal.address}`,
    assetId,
    withdrawalAmount,
    withdrawalIndex + 1
  );
}

function buildWalletDeltaPostings(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  walletAssetTotals: WalletAssetTotals,
  walletPaysNetworkFee: boolean,
  feeAmount: Decimal,
  protocolDepositDeltaAmount: Decimal,
  treasuryDonationAmount: Decimal,
  walletWithdrawalAmount: Decimal,
  walletDeltaRole: AccountingPostingRole
): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const walletDeltaPostings: AccountingPostingDraft[] = [];
    const units = new Set([...walletAssetTotals.inputsByUnit.keys(), ...walletAssetTotals.outputsByUnit.keys()]);

    for (const unit of [...units].sort()) {
      const walletInputAmount = walletAssetTotals.inputsByUnit.get(unit)?.amount ?? new Decimal(0);
      const walletOutputAmount = walletAssetTotals.outputsByUnit.get(unit)?.amount ?? new Decimal(0);
      const feeAdjustment = walletPaysNetworkFee && unit === 'lovelace' ? feeAmount : new Decimal(0);
      const protocolDepositAdjustment =
        walletPaysNetworkFee && unit === 'lovelace' ? protocolDepositDeltaAmount : new Decimal(0);
      const rewardFundingAdjustment =
        walletPaysNetworkFee && unit === 'lovelace' ? walletWithdrawalAmount : new Decimal(0);
      const treasuryDonationAdjustment =
        walletPaysNetworkFee && unit === 'lovelace' ? treasuryDonationAmount : new Decimal(0);
      const quantity = walletOutputAmount
        .minus(walletInputAmount)
        .plus(feeAdjustment)
        .plus(protocolDepositAdjustment)
        .plus(treasuryDonationAdjustment)
        .minus(rewardFundingAdjustment);
      const assetAmount = walletAssetTotals.outputsByUnit.get(unit) ?? walletAssetTotals.inputsByUnit.get(unit);

      if (!assetAmount) {
        continue;
      }

      const posting = yield* buildWalletDeltaPosting({
        assetAmount,
        quantity,
        role: walletDeltaRole,
        sourceActivityFingerprint,
        transaction,
        walletInputAmount,
        walletInputs: walletAssetTotals.walletInputs,
        walletOutputAmount,
        walletOutputs: walletAssetTotals.walletOutputs,
      });

      if (posting) {
        walletDeltaPostings.push(posting);
      }
    }

    return walletDeltaPostings;
  });
}

function buildStakingRewardPosting(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  walletPaysNetworkFee: boolean,
  walletScope: CardanoWalletScope,
  withdrawalAmounts: readonly Decimal[],
  walletWithdrawalAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  return resultDo(function* () {
    const withdrawals = transaction.withdrawals ?? [];
    if (withdrawals.length === 0 || !walletPaysNetworkFee || walletWithdrawalAmount.isZero()) {
      return undefined;
    }

    const assetRef = yield* buildCardanoAssetRefFromUnit('lovelace', 'ADA');
    const sourceComponentRefs: SourceComponentQuantityRef[] = [];
    for (let index = 0; index < withdrawals.length; index++) {
      const withdrawal = withdrawals[index];
      const withdrawalAmount = withdrawalAmounts[index];
      if (!withdrawal || withdrawalAmount === undefined) {
        return yield* err(
          new Error(`Cardano v2 staking reward posting for transaction ${transaction.id} is missing withdrawal amount`)
        );
      }

      if (!isWalletStakeAddress(withdrawal.address, walletScope, walletPaysNetworkFee)) {
        continue;
      }

      const ref = buildStakingRewardComponentRef(
        sourceActivityFingerprint,
        withdrawal,
        index,
        assetRef.assetId,
        withdrawalAmount
      );
      if (!ref.quantity.isZero()) {
        sourceComponentRefs.push(ref);
      }
    }

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

function buildStakeCertificateComponentRef(
  sourceActivityFingerprint: string,
  certificate: CardanoStakeCertificate,
  assetId: string,
  quantity: Decimal
): SourceComponentQuantityRef {
  return buildPostingComponentRef(
    sourceActivityFingerprint,
    'cardano_stake_certificate',
    `${certificate.action}:${certificate.address}:${certificate.certificateIndex}`,
    assetId,
    quantity,
    certificate.certificateIndex + 1
  );
}

function buildRawDepositComponentRef(
  sourceActivityFingerprint: string,
  transactionId: string,
  assetId: string,
  quantity: Decimal
): SourceComponentQuantityRef {
  return buildPostingComponentRef(
    sourceActivityFingerprint,
    'raw_event',
    `${transactionId}:protocol_deposit`,
    assetId,
    quantity
  );
}

function buildTreasuryDonationComponentRef(
  sourceActivityFingerprint: string,
  transactionId: string,
  assetId: string,
  quantity: Decimal
): SourceComponentQuantityRef {
  return buildPostingComponentRef(
    sourceActivityFingerprint,
    'raw_event',
    `${transactionId}:treasury_donation`,
    assetId,
    quantity
  );
}

function buildProtocolDepositPosting(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  walletPaysNetworkFee: boolean,
  protocolDepositDeltaAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  if (!walletPaysNetworkFee || protocolDepositDeltaAmount.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit('lovelace', 'ADA');
    const quantity = protocolDepositDeltaAmount.negated();
    const depositMagnitude = protocolDepositDeltaAmount.abs();
    const relevantAction = protocolDepositDeltaAmount.gt(0) ? 'registration' : 'deregistration';
    const relevantCertificates = (transaction.stakeCertificates ?? []).filter(
      (certificate) => certificate.action === relevantAction
    );
    const sourceComponentRefs =
      relevantCertificates.length > 0
        ? relevantCertificates.map((certificate) =>
            buildStakeCertificateComponentRef(
              sourceActivityFingerprint,
              certificate,
              assetRef.assetId,
              depositMagnitude.dividedBy(relevantCertificates.length)
            )
          )
        : [buildRawDepositComponentRef(sourceActivityFingerprint, transaction.id, assetRef.assetId, depositMagnitude)];

    return {
      postingStableKey: protocolDepositDeltaAmount.gt(0) ? 'protocol_deposit:lovelace' : 'protocol_refund:lovelace',
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity,
      role: protocolDepositDeltaAmount.gt(0) ? 'protocol_deposit' : 'protocol_refund',
      sourceComponentRefs,
    };
  });
}

function buildTreasuryDonationPosting(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  walletPaysNetworkFee: boolean,
  treasuryDonationAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  if (!walletPaysNetworkFee || treasuryDonationAmount.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit('lovelace', 'ADA');

    return {
      postingStableKey: 'treasury_donation:lovelace',
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity: treasuryDonationAmount.negated(),
      role: 'protocol_overhead',
      sourceComponentRefs: [
        buildTreasuryDonationComponentRef(
          sourceActivityFingerprint,
          transaction.id,
          assetRef.assetId,
          treasuryDonationAmount
        ),
      ],
    };
  });
}

function buildProtocolEventPostings(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  walletPaysNetworkFee: boolean,
  protocolDepositDeltaAmount: Decimal,
  treasuryDonationAmount: Decimal
): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];
    const depositPosting = yield* buildProtocolDepositPosting(
      transaction,
      sourceActivityFingerprint,
      walletPaysNetworkFee,
      protocolDepositDeltaAmount
    );
    const treasuryDonationPosting = yield* buildTreasuryDonationPosting(
      transaction,
      sourceActivityFingerprint,
      walletPaysNetworkFee,
      treasuryDonationAmount
    );

    if (depositPosting) {
      postings.push(depositPosting);
    }

    if (treasuryDonationPosting) {
      postings.push(treasuryDonationPosting);
    }

    return postings;
  });
}

function sumWalletWithdrawalAmount(
  withdrawals: readonly CardanoWithdrawal[],
  withdrawalAmounts: readonly Decimal[],
  walletPaysNetworkFee: boolean,
  walletScope: CardanoWalletScope
): Result<Decimal, Error> {
  return resultDo(function* () {
    if (!walletPaysNetworkFee) {
      return new Decimal(0);
    }

    let sum = new Decimal(0);
    for (let index = 0; index < withdrawals.length; index++) {
      const withdrawal = withdrawals[index];
      const withdrawalAmount = withdrawalAmounts[index];
      if (!withdrawal || withdrawalAmount === undefined) {
        return yield* err(new Error(`Cardano v2 staking reward amount for withdrawal index ${index} is missing`));
      }

      if (isWalletStakeAddress(withdrawal.address, walletScope, walletPaysNetworkFee)) {
        sum = sum.plus(withdrawalAmount);
      }
    }

    return sum;
  });
}

function resolveFeeOnlyJournalDescriptor(parts: CardanoJournalAssemblyParts): CardanoFeeOnlyJournalDescriptor {
  if (parts.walletDeltaJournalKind === 'protocol_event' || parts.hasProtocolEvidence) {
    return {
      journalKind: 'protocol_event',
      journalStableKey: parts.protocolEventStableKey,
    };
  }

  return {
    journalKind: 'expense_only',
    journalStableKey: 'network_fee',
  };
}

function buildCardanoJournals(parts: CardanoJournalAssemblyParts): AccountingJournalDraft[] {
  const journals: AccountingJournalDraft[] = [];
  let pendingFeePosting = parts.feePosting;
  let pendingDiagnostics = parts.diagnostics.length > 0 ? [...parts.diagnostics] : undefined;

  function attachDiagnostics(journal: AccountingJournalDraft): AccountingJournalDraft {
    if (!pendingDiagnostics) {
      return journal;
    }

    const diagnosticsToAttach = pendingDiagnostics;
    pendingDiagnostics = undefined;
    return {
      ...journal,
      diagnostics: diagnosticsToAttach,
    };
  }

  if (parts.walletDeltaPostings.length > 0) {
    const postings = pendingFeePosting
      ? [...parts.walletDeltaPostings, pendingFeePosting]
      : [...parts.walletDeltaPostings];
    pendingFeePosting = undefined;

    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: parts.walletDeltaJournalKind,
        journalKind: parts.walletDeltaJournalKind,
        postings,
      })
    );
  }

  if (parts.rewardPosting) {
    const postings = pendingFeePosting ? [parts.rewardPosting, pendingFeePosting] : [parts.rewardPosting];
    pendingFeePosting = undefined;

    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: 'staking_reward',
        journalKind: 'staking_reward',
        postings,
      })
    );
  }

  if (parts.protocolEventPostings.length > 0) {
    const postings = pendingFeePosting
      ? [...parts.protocolEventPostings, pendingFeePosting]
      : [...parts.protocolEventPostings];
    pendingFeePosting = undefined;

    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: parts.protocolEventStableKey,
        journalKind: 'protocol_event',
        postings,
      })
    );
  }

  if (pendingFeePosting) {
    const feeOnlyJournal = resolveFeeOnlyJournalDescriptor(parts);
    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: feeOnlyJournal.journalStableKey,
        journalKind: feeOnlyJournal.journalKind,
        postings: [pendingFeePosting],
      })
    );
  }

  return journals;
}

function hasCollateralWalletEffect(walletAssetTotals: WalletAssetTotals): boolean {
  return (
    walletAssetTotals.walletInputs.some((input) => input.isCollateral === true) ||
    walletAssetTotals.walletOutputs.some((output) => output.isCollateral === true)
  );
}

function resolveCardanoWalletDeltaJournalKind(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals
): CardanoWalletDeltaJournalKind {
  return transaction.status === 'failed' && hasCollateralWalletEffect(walletAssetTotals)
    ? 'protocol_event'
    : 'transfer';
}

function resolveCardanoWalletDeltaRole(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals
): AccountingPostingRole {
  return transaction.status === 'failed' && hasCollateralWalletEffect(walletAssetTotals)
    ? 'protocol_overhead'
    : 'principal';
}

function hasCardanoProtocolEvidence(
  transaction: CardanoTransaction,
  validatedAmounts: ValidatedCardanoAmounts
): boolean {
  return (
    (transaction.stakeCertificates?.length ?? 0) > 0 ||
    (transaction.delegationCertificates?.length ?? 0) > 0 ||
    (transaction.mirCertificates?.length ?? 0) > 0 ||
    !validatedAmounts.protocolDepositDeltaAmount.isZero() ||
    !validatedAmounts.treasuryDonationAmount.isZero()
  );
}

function resolveCardanoProtocolEventStableKey(
  transaction: CardanoTransaction,
  validatedAmounts: ValidatedCardanoAmounts
): string {
  if (
    (transaction.stakeCertificates?.length ?? 0) > 0 ||
    (transaction.delegationCertificates?.length ?? 0) > 0 ||
    !validatedAmounts.protocolDepositDeltaAmount.isZero()
  ) {
    return 'staking_lifecycle';
  }

  if ((transaction.mirCertificates?.length ?? 0) > 0) {
    return 'mir_certificates';
  }

  if (!validatedAmounts.treasuryDonationAmount.isZero()) {
    return 'treasury_donation';
  }

  return 'protocol_event';
}

function buildCardanoDiagnostics(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals,
  validatedAmounts: ValidatedCardanoAmounts
): AccountingDiagnosticDraft[] {
  const diagnostics: AccountingDiagnosticDraft[] = [];
  const referenceInputCount = transaction.inputs.filter((input) => input.isReference === true).length;
  const ignoredSuccessfulCollateralInputCount = transaction.inputs.filter(
    (input) => transaction.status !== 'failed' && input.isCollateral === true
  ).length;
  const collateralWalletInputCount = walletAssetTotals.walletInputs.filter(
    (input) => input.isCollateral === true
  ).length;
  const collateralWalletOutputCount = walletAssetTotals.walletOutputs.filter(
    (output) => output.isCollateral === true
  ).length;
  const stakeCertificateCount = transaction.stakeCertificates?.length ?? 0;
  const delegationCertificateCount = transaction.delegationCertificates?.length ?? 0;
  const mirCertificateCount = transaction.mirCertificates?.length ?? 0;

  if (referenceInputCount > 0) {
    diagnostics.push({
      code: 'cardano_reference_inputs_ignored',
      message: `Cardano transaction ${transaction.id} contains ${referenceInputCount} reference input(s); reference inputs are read-only and excluded from wallet balance accounting.`,
      severity: 'info',
    });
  }

  if (ignoredSuccessfulCollateralInputCount > 0) {
    diagnostics.push({
      code: 'cardano_collateral_inputs_ignored',
      message: `Cardano transaction ${transaction.id} contains ${ignoredSuccessfulCollateralInputCount} collateral input(s) on a successful script transaction; collateral inputs are excluded because they were not consumed.`,
      severity: 'info',
    });
  }

  if (transaction.status === 'failed' && (collateralWalletInputCount > 0 || collateralWalletOutputCount > 0)) {
    diagnostics.push({
      code: 'cardano_failed_script_collateral',
      message: `Cardano transaction ${transaction.id} failed script validation; wallet accounting uses collateral inputs and collateral return outputs.`,
      severity: 'warning',
    });
  }

  if (stakeCertificateCount > 0) {
    diagnostics.push({
      code: 'cardano_stake_certificates',
      message: `Cardano transaction ${transaction.id} contains ${stakeCertificateCount} stake address registration certificate(s).`,
      severity: 'info',
    });
  }

  if (delegationCertificateCount > 0) {
    diagnostics.push({
      code: 'cardano_delegation_certificates',
      message: `Cardano transaction ${transaction.id} contains ${delegationCertificateCount} delegation certificate(s).`,
      severity: 'info',
    });
  }

  if (mirCertificateCount > 0) {
    diagnostics.push({
      code: 'cardano_mir_certificates',
      message: `Cardano transaction ${transaction.id} contains ${mirCertificateCount} MIR certificate(s). MIR rewards are preserved as chain evidence and are not spendable UTXO balance until withdrawn.`,
      severity: 'info',
    });
  }

  if (!validatedAmounts.protocolDepositDeltaAmount.isZero() && stakeCertificateCount === 0) {
    diagnostics.push({
      code: 'cardano_unattributed_protocol_deposit',
      message: `Cardano transaction ${transaction.id} has a protocol deposit delta of ${validatedAmounts.protocolDepositDeltaAmount.toFixed()} ADA without a stake address certificate in normalized data.`,
      severity: 'warning',
    });
  }

  return diagnostics;
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
    walletAssetTotals.walletInputs[0]?.address ??
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
  if (walletAssetTotals.walletInputs.length > 0 && externalOutputAddress !== undefined) {
    return externalOutputAddress;
  }

  return walletAssetTotals.walletOutputs[0]?.address ?? externalOutputAddress ?? transaction.outputs[0]?.address;
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
    ...(transaction.blockHeight === undefined ? {} : { blockchainBlockHeight: transaction.blockHeight }),
    blockchainTransactionHash: transaction.id,
    blockchainIsConfirmed: transaction.status === 'success',
  };
}

export function assembleCardanoLedgerDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<CardanoLedgerDraft, Error> {
  return resultDo(function* () {
    const validatedAmounts = yield* validateCardanoTransactionAmounts(transaction);
    const walletScope = yield* validateCardanoProcessorV2Context(context);
    const sourceActivityFingerprint = yield* computeCardanoSourceActivityFingerprint(transaction, context);
    const walletAssetTotals = yield* collectWalletAssetTotals(transaction, walletScope.walletAddresses);
    yield* validateWalletScopeEffect(transaction, walletAssetTotals);
    const walletPaysNetworkFee = walletAssetTotals.walletInputs.length > 0;
    const walletWithdrawalAmount = yield* sumWalletWithdrawalAmount(
      transaction.withdrawals ?? [],
      validatedAmounts.withdrawalAmounts,
      walletPaysNetworkFee,
      walletScope
    );
    const walletDeltaJournalKind = resolveCardanoWalletDeltaJournalKind(transaction, walletAssetTotals);
    const walletDeltaRole = resolveCardanoWalletDeltaRole(transaction, walletAssetTotals);
    const diagnostics = buildCardanoDiagnostics(transaction, walletAssetTotals, validatedAmounts);
    const feePosting = yield* buildOptionalNetworkFeePosting(
      sourceActivityFingerprint,
      transaction,
      walletPaysNetworkFee,
      validatedAmounts.feeAmount
    );
    const walletDeltaPostings = yield* buildWalletDeltaPostings(
      transaction,
      sourceActivityFingerprint,
      walletAssetTotals,
      walletPaysNetworkFee,
      validatedAmounts.feeAmount,
      validatedAmounts.protocolDepositDeltaAmount,
      validatedAmounts.treasuryDonationAmount,
      walletWithdrawalAmount,
      walletDeltaRole
    );
    const rewardPosting = yield* buildStakingRewardPosting(
      transaction,
      sourceActivityFingerprint,
      walletPaysNetworkFee,
      walletScope,
      validatedAmounts.withdrawalAmounts,
      walletWithdrawalAmount
    );
    const protocolEventPostings = yield* buildProtocolEventPostings(
      transaction,
      sourceActivityFingerprint,
      walletPaysNetworkFee,
      validatedAmounts.protocolDepositDeltaAmount,
      validatedAmounts.treasuryDonationAmount
    );
    const hasProtocolEvidence = hasCardanoProtocolEvidence(transaction, validatedAmounts);
    const protocolEventStableKey = resolveCardanoProtocolEventStableKey(transaction, validatedAmounts);
    const journals = buildCardanoJournals({
      sourceActivityFingerprint,
      walletDeltaPostings,
      rewardPosting,
      protocolEventPostings,
      feePosting,
      walletDeltaJournalKind,
      hasProtocolEvidence,
      protocolEventStableKey,
      diagnostics,
    });
    const sourceActivity = buildCardanoSourceActivityDraft(
      transaction,
      context,
      sourceActivityFingerprint,
      walletAssetTotals,
      walletScope.walletAddresses
    );

    return {
      sourceActivity,
      journals,
    };
  });
}
