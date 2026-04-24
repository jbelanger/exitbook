import type {
  CardanoAssetAmount,
  CardanoTransaction,
  CardanoTransactionInput,
  CardanoTransactionOutput,
} from '@exitbook/blockchain-providers/cardano';
import { err, ok, resultDo, type Result } from '@exitbook/foundation';

import { validateLedgerProcessorAccountContext } from '../shared/ledger-assembler-utils.js';

import { normalizeCardanoAddress } from './address-utils.js';
import { normalizeCardanoAssetQuantity } from './journal-assembler-amounts.js';
import type {
  CardanoProcessorV2Context,
  CardanoWalletScope,
  WalletAssetAmount,
  WalletAssetTotals,
} from './journal-assembler-types.js';

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

export function validateCardanoProcessorV2Context(
  context: CardanoProcessorV2Context
): Result<CardanoWalletScope, Error> {
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

export function isWalletStakeAddress(
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

export function collectWalletAssetTotals(
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

export function validateWalletScopeEffect(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals
): Result<void, Error> {
  if (walletAssetTotals.inputsByUnit.size === 0 && walletAssetTotals.outputsByUnit.size === 0) {
    return err(new Error(`Cardano v2 transaction ${transaction.id} has no effect for the wallet address scope`));
  }

  return ok(undefined);
}

function findFirstExternalAddress(
  entries: readonly { address: string }[],
  walletAddresses: ReadonlySet<string>
): string | undefined {
  return entries.find((entry) => !isWalletAddress(entry.address, walletAddresses))?.address;
}

export function resolveCardanoSourceActivityFromAddress(
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

export function resolveCardanoSourceActivityToAddress(
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
