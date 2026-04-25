import { normalizeEvmAddress, type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  err,
  ok,
  parseDecimal,
  resultDo,
  type Result,
} from '@exitbook/foundation';

import type { AccountBasedLedgerChainConfig } from './journal-assembler-types.js';
import type { EvmProtocolEvent } from './types.js';

const WRAPPED_NATIVE_DEPOSIT_METHOD_ID = '0xd0e30db0';
const WRAPPED_NATIVE_WITHDRAW_METHOD_ID = '0x2e1a7d4d';
const UINT256_HEX_LENGTH = 64;

interface ExpandedEvmProtocolTransactions {
  protocolEvents: EvmProtocolEvent[];
  transactions: EvmTransaction[];
}

interface WrappedNativeContext {
  chainConfig: AccountBasedLedgerChainConfig;
  nativeAssetId: string;
  userAddresses: ReadonlySet<string>;
  wrappedAsset: NonNullable<AccountBasedLedgerChainConfig['wrappedNativeAsset']> & {
    contractAddress: string;
  };
  wrappedAssetId: string;
}

function normalizeOptionalMethodId(methodId: string | undefined): string | undefined {
  const normalized = methodId?.trim().toLowerCase();
  return normalized && normalized !== '0x' ? normalized : undefined;
}

function isPositiveBaseUnitAmount(amount: string): boolean {
  return parseDecimal(amount).gt(0);
}

function isWrappedNativeContract(address: string | undefined, wrappedContractAddress: string): boolean {
  return address !== undefined && normalizeEvmAddress(address) === wrappedContractAddress;
}

function isUserAddress(address: string | undefined, userAddresses: ReadonlySet<string>): boolean {
  return address !== undefined && userAddresses.has(normalizeEvmAddress(address));
}

function hasMatchingWrappedTokenMovement(params: {
  amount: string;
  direction: 'in' | 'out';
  transactions: readonly EvmTransaction[];
  userAddress: string;
  wrappedContractAddress: string;
}): boolean {
  return params.transactions.some((transaction) => {
    if (
      transaction.type !== 'token_transfer' ||
      transaction.amount !== params.amount ||
      !isWrappedNativeContract(transaction.tokenAddress, params.wrappedContractAddress)
    ) {
      return false;
    }

    return params.direction === 'in'
      ? normalizeEvmAddress(transaction.to) === params.userAddress
      : normalizeEvmAddress(transaction.from) === params.userAddress;
  });
}

function hasMatchingNativeMovement(params: {
  amount: string;
  direction: 'in' | 'out';
  nativeCurrency: string;
  transactions: readonly EvmTransaction[];
  userAddress: string;
  wrappedContractAddress: string;
}): boolean {
  return params.transactions.some((transaction) => {
    if (
      transaction.amount !== params.amount ||
      transaction.currency.toLowerCase() !== params.nativeCurrency.toLowerCase()
    ) {
      return false;
    }

    if (params.direction === 'in') {
      return (
        normalizeEvmAddress(transaction.to) === params.userAddress &&
        isWrappedNativeContract(transaction.from, params.wrappedContractAddress)
      );
    }

    return (
      normalizeEvmAddress(transaction.from) === params.userAddress &&
      isWrappedNativeContract(transaction.to, params.wrappedContractAddress)
    );
  });
}

function buildSyntheticWrappedTokenTransfer(params: {
  amount: string;
  direction: 'in' | 'out';
  parentTransaction: EvmTransaction;
  userAddress: string;
  wrappedAsset: WrappedNativeContext['wrappedAsset'];
}): EvmTransaction {
  return {
    amount: params.amount,
    blockHeight: params.parentTransaction.blockHeight,
    blockId: params.parentTransaction.blockId,
    currency: params.wrappedAsset.symbol,
    eventId: `${params.parentTransaction.eventId}:wrapped-native:${params.direction}:token`,
    feeAmount: '0',
    feeCurrency: params.parentTransaction.feeCurrency,
    from: params.direction === 'in' ? params.wrappedAsset.contractAddress : params.userAddress,
    gasPrice: '0',
    gasUsed: '0',
    id: params.parentTransaction.id,
    providerName: params.parentTransaction.providerName,
    status: params.parentTransaction.status,
    timestamp: params.parentTransaction.timestamp,
    to: params.direction === 'in' ? params.userAddress : params.wrappedAsset.contractAddress,
    tokenAddress: params.wrappedAsset.contractAddress,
    tokenDecimals: params.wrappedAsset.decimals,
    tokenSymbol: params.wrappedAsset.symbol,
    tokenType: 'erc20',
    type: 'token_transfer',
  };
}

function buildSyntheticNativeMovement(params: {
  amount: string;
  direction: 'in' | 'out';
  parentTransaction: EvmTransaction;
  userAddress: string;
  wrappedContractAddress: string;
}): EvmTransaction {
  return {
    amount: params.amount,
    blockHeight: params.parentTransaction.blockHeight,
    blockId: params.parentTransaction.blockId,
    currency: params.parentTransaction.currency,
    eventId: `${params.parentTransaction.eventId}:wrapped-native:${params.direction}:native`,
    feeAmount: '0',
    feeCurrency: params.parentTransaction.feeCurrency,
    from: params.direction === 'in' ? params.wrappedContractAddress : params.userAddress,
    gasPrice: '0',
    gasUsed: '0',
    id: params.parentTransaction.id,
    providerName: params.parentTransaction.providerName,
    status: params.parentTransaction.status,
    timestamp: params.parentTransaction.timestamp,
    to: params.direction === 'in' ? params.userAddress : params.wrappedContractAddress,
    tokenType: 'native',
    type: params.direction === 'in' ? 'internal' : 'transfer',
  };
}

function decodeWithdrawAmount(inputData: string | undefined, transactionId: string): Result<string, Error> {
  const normalizedInputData = inputData?.trim().toLowerCase();
  const expectedLength = 2 + WRAPPED_NATIVE_WITHDRAW_METHOD_ID.slice(2).length + UINT256_HEX_LENGTH;
  if (!normalizedInputData || normalizedInputData.length < expectedLength) {
    return err(new Error(`EVM v2 wrapped-native withdraw ${transactionId} is missing uint256 calldata amount`));
  }

  const amountHex = normalizedInputData.slice(10, 10 + UINT256_HEX_LENGTH);
  if (!/^[0-9a-f]{64}$/.test(amountHex)) {
    return err(new Error(`EVM v2 wrapped-native withdraw ${transactionId} has invalid uint256 calldata amount`));
  }

  return ok(BigInt(`0x${amountHex}`).toString());
}

function buildProtocolEvent(params: {
  amount: string;
  kind: EvmProtocolEvent['kind'];
  nativeAssetId: string;
  wrappedAssetId: string;
}): EvmProtocolEvent {
  return {
    amountBaseUnits: params.amount,
    kind: params.kind,
    relationshipKind: 'asset_migration',
    sourceAssetId: params.kind === 'wrapped_native_asset' ? params.nativeAssetId : params.wrappedAssetId,
    targetAssetId: params.kind === 'wrapped_native_asset' ? params.wrappedAssetId : params.nativeAssetId,
  };
}

function maybeExpandWrappedNativeDeposit(
  transaction: EvmTransaction,
  context: WrappedNativeContext,
  transactions: readonly EvmTransaction[]
): EvmTransaction[] {
  const userAddress = normalizeEvmAddress(transaction.from);
  if (
    transaction.status !== 'success' ||
    normalizeOptionalMethodId(transaction.methodId) !== WRAPPED_NATIVE_DEPOSIT_METHOD_ID ||
    !isWrappedNativeContract(transaction.to, context.wrappedAsset.contractAddress) ||
    !isUserAddress(userAddress, context.userAddresses) ||
    !isPositiveBaseUnitAmount(transaction.amount)
  ) {
    return [];
  }

  return hasMatchingWrappedTokenMovement({
    amount: transaction.amount,
    direction: 'in',
    transactions,
    userAddress,
    wrappedContractAddress: context.wrappedAsset.contractAddress,
  })
    ? []
    : [
        buildSyntheticWrappedTokenTransfer({
          amount: transaction.amount,
          direction: 'in',
          parentTransaction: transaction,
          userAddress,
          wrappedAsset: context.wrappedAsset,
        }),
      ];
}

function maybeExpandWrappedNativeWithdraw(
  transaction: EvmTransaction,
  context: WrappedNativeContext,
  transactions: readonly EvmTransaction[]
): Result<EvmTransaction[], Error> {
  return resultDo(function* () {
    const userAddress = normalizeEvmAddress(transaction.from);
    if (
      transaction.status !== 'success' ||
      normalizeOptionalMethodId(transaction.methodId) !== WRAPPED_NATIVE_WITHDRAW_METHOD_ID ||
      !isWrappedNativeContract(transaction.to, context.wrappedAsset.contractAddress) ||
      !isUserAddress(userAddress, context.userAddresses)
    ) {
      return [];
    }

    const amount = yield* decodeWithdrawAmount(transaction.inputData, transaction.id);
    if (!isPositiveBaseUnitAmount(amount)) {
      return [];
    }

    const expandedTransactions: EvmTransaction[] = [];
    if (
      !hasMatchingWrappedTokenMovement({
        amount,
        direction: 'out',
        transactions,
        userAddress,
        wrappedContractAddress: context.wrappedAsset.contractAddress,
      })
    ) {
      expandedTransactions.push(
        buildSyntheticWrappedTokenTransfer({
          amount,
          direction: 'out',
          parentTransaction: transaction,
          userAddress,
          wrappedAsset: context.wrappedAsset,
        })
      );
    }

    if (
      !hasMatchingNativeMovement({
        amount,
        direction: 'in',
        nativeCurrency: context.chainConfig.nativeCurrency,
        transactions,
        userAddress,
        wrappedContractAddress: context.wrappedAsset.contractAddress,
      })
    ) {
      expandedTransactions.push(
        buildSyntheticNativeMovement({
          amount,
          direction: 'in',
          parentTransaction: transaction,
          userAddress,
          wrappedContractAddress: context.wrappedAsset.contractAddress,
        })
      );
    }

    return expandedTransactions;
  });
}

function detectWrappedNativeProtocolEvent(
  transaction: EvmTransaction,
  context: WrappedNativeContext
): Result<EvmProtocolEvent | undefined, Error> {
  return resultDo(function* () {
    if (
      transaction.status !== 'success' ||
      !isWrappedNativeContract(transaction.to, context.wrappedAsset.contractAddress) ||
      !isUserAddress(transaction.from, context.userAddresses)
    ) {
      return undefined;
    }

    const methodId = normalizeOptionalMethodId(transaction.methodId);
    if (methodId === WRAPPED_NATIVE_DEPOSIT_METHOD_ID && isPositiveBaseUnitAmount(transaction.amount)) {
      return buildProtocolEvent({
        amount: transaction.amount,
        kind: 'wrapped_native_asset',
        nativeAssetId: context.nativeAssetId,
        wrappedAssetId: context.wrappedAssetId,
      });
    }

    if (methodId !== WRAPPED_NATIVE_WITHDRAW_METHOD_ID) {
      return undefined;
    }

    const amount = yield* decodeWithdrawAmount(transaction.inputData, transaction.id);
    if (!isPositiveBaseUnitAmount(amount)) {
      return undefined;
    }

    return buildProtocolEvent({
      amount,
      kind: 'unwrapped_native_asset',
      nativeAssetId: context.nativeAssetId,
      wrappedAssetId: context.wrappedAssetId,
    });
  });
}

export function expandEvmWrappedNativeProtocolTransactions(params: {
  chainConfig: AccountBasedLedgerChainConfig;
  transactions: readonly EvmTransaction[];
  userAddresses: readonly string[];
}): Result<ExpandedEvmProtocolTransactions, Error> {
  return resultDo(function* () {
    const wrappedNativeAsset = params.chainConfig.wrappedNativeAsset;
    if (!wrappedNativeAsset) {
      return {
        protocolEvents: [],
        transactions: [...params.transactions],
      };
    }

    const wrappedContractAddress = normalizeEvmAddress(wrappedNativeAsset.contractAddress);
    const context: WrappedNativeContext = {
      chainConfig: params.chainConfig,
      nativeAssetId: yield* buildBlockchainNativeAssetId(params.chainConfig.chainName),
      userAddresses: new Set(params.userAddresses.map((address) => normalizeEvmAddress(address))),
      wrappedAsset: {
        ...wrappedNativeAsset,
        contractAddress: wrappedContractAddress,
      },
      wrappedAssetId: yield* buildBlockchainTokenAssetId(params.chainConfig.chainName, wrappedContractAddress),
    };

    const expandedTransactions = [...params.transactions];
    const protocolEvents: EvmProtocolEvent[] = [];

    for (const transaction of params.transactions) {
      const protocolEvent = yield* detectWrappedNativeProtocolEvent(transaction, context);
      if (protocolEvent) {
        protocolEvents.push(protocolEvent);
      }

      expandedTransactions.push(...maybeExpandWrappedNativeDeposit(transaction, context, params.transactions));
      expandedTransactions.push(
        ...(yield* maybeExpandWrappedNativeWithdraw(transaction, context, params.transactions))
      );
    }

    return {
      protocolEvents,
      transactions: expandedTransactions,
    };
  });
}
