import type {
  CardanoTransaction,
  CardanoTransactionInput,
  CardanoTransactionOutput,
} from '@exitbook/blockchain-providers/cardano';
import {
  buildBlockchainNativeAssetId,
  err,
  ok,
  parseCurrency,
  resultDo,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import type {
  AccountingPostingDraft,
  AccountingPostingRole,
  AccountingSourceComponentKind,
  SourceComponentQuantityRef,
} from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import { buildSourceComponentQuantityRef } from '../shared/ledger-assembler-utils.js';
import { buildUtxoSourceComponentId } from '../shared/ledger-utxo-utils.js';

import { buildCardanoAssetRefFromUnit, normalizeCardanoAssetQuantity } from './journal-assembler-amounts.js';
import type {
  CardanoLedgerStakeCertificate,
  CardanoLedgerWithdrawal,
  CardanoWalletScope,
  WalletAssetAmount,
  WalletAssetTotals,
} from './journal-assembler-types.js';
import { isWalletStakeAddress } from './journal-assembler-wallet.js';

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
  return buildUtxoSourceComponentId({
    outputIndex: input.outputIndex,
    transactionHash: input.txHash,
  });
}

function buildUtxoOutputComponentId(transactionId: string, output: CardanoTransactionOutput): string {
  return buildUtxoSourceComponentId({
    outputIndex: output.outputIndex,
    transactionHash: transactionId,
  });
}

function resolveCardanoInputComponentKind(input: CardanoTransactionInput): AccountingSourceComponentKind {
  return input.isCollateral === true ? 'cardano_collateral_input' : 'utxo_input';
}

function resolveCardanoOutputComponentKind(output: CardanoTransactionOutput): AccountingSourceComponentKind {
  return output.isCollateral === true ? 'cardano_collateral_return' : 'utxo_output';
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

export function buildOptionalNetworkFeePosting(
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

function buildStakingRewardComponentRef(
  sourceActivityFingerprint: string,
  withdrawal: CardanoLedgerWithdrawal,
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

export function buildWalletDeltaPostings(
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

export function buildStakingRewardPosting(
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
  certificate: CardanoLedgerStakeCertificate,
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

export function buildProtocolEventPostings(
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

export function sumWalletWithdrawalAmount(
  withdrawals: readonly CardanoLedgerWithdrawal[],
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
