import { parseDecimal, type Result, err } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { NormalizationError } from '../../../../contracts/errors.js';
import { generateUniqueTransactionEventId } from '../../../../normalization/event-id.js';
import { validateOutput } from '../../../../normalization/mapper-validation.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { CosmosTransactionSchema } from '../../schemas.js';
import type { CosmosTransaction } from '../../types.js';
import { formatDenom } from '../../utils.js';
import type { CosmosEvent, CosmosEventAttribute } from '../cosmos-rest/cosmos-rest.schemas.js';

import type { GetBlockHydratedTx } from './getblock.schemas.js';

const logger = getLogger('GetBlockCosmosMapperUtils');

const BANK_SEND_MESSAGE = '/cosmos.bank.v1beta1.MsgSend';
const BANK_MULTI_SEND_MESSAGE = '/cosmos.bank.v1beta1.MsgMultiSend';
const IBC_TRANSFER_MESSAGE = '/ibc.applications.transfer.v1.MsgTransfer';
const WITHDRAW_REWARD_MESSAGE = '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward';
const DELEGATE_MESSAGE = '/cosmos.staking.v1beta1.MsgDelegate';
const UNDELEGATE_MESSAGE = '/cosmos.staking.v1beta1.MsgUndelegate';
const REDELEGATE_MESSAGE = '/cosmos.staking.v1beta1.MsgBeginRedelegate';

interface ParsedCosmosCoin {
  amountBaseUnits: string;
  denom: string;
}

interface ParsedDisplayCoin {
  amount: string;
  currency: string;
  tokenAddress?: string | undefined;
  tokenSymbol: string;
  tokenType: 'ibc' | 'native';
}

interface EventMatch {
  event: CosmosEvent;
  eventIndex: number;
  messageIndex?: string | undefined;
}

interface MappedEventFields {
  amount: string;
  bridgeType?: 'ibc' | 'native' | undefined;
  currency: string;
  from: string;
  messageIndex?: string | undefined;
  messageType: string;
  sourceChannel?: string | undefined;
  sourcePort?: string | undefined;
  stakingDestinationValidatorAddress?: string | undefined;
  stakingPrincipalAmount?: string | undefined;
  stakingPrincipalCurrency?: string | undefined;
  stakingPrincipalDenom?: string | undefined;
  stakingValidatorAddress?: string | undefined;
  to: string;
  tokenAddress?: string | undefined;
  tokenSymbol?: string | undefined;
  tokenType?: 'ibc' | 'native' | undefined;
  traceId: string;
  txType?: string | undefined;
}

function getAttributeValue(attributes: CosmosEventAttribute[], key: string): string | undefined {
  return attributes.find((attribute) => attribute.key === key)?.value;
}

function getFirstAttributeValue(attributes: CosmosEventAttribute[], keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getAttributeValue(attributes, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function getMessageIndex(event: CosmosEvent): string | undefined {
  return getAttributeValue(event.attributes, 'msg_index');
}

function eventMatchesAddress(event: CosmosEvent, addressKey: string, address: string): boolean {
  return getAttributeValue(event.attributes, addressKey)?.toLowerCase() === address;
}

function findEventsByType(events: CosmosEvent[], type: string): EventMatch[] {
  return events.flatMap((event, eventIndex) => {
    if (event.type !== type) {
      return [];
    }
    return [{ event, eventIndex, messageIndex: getMessageIndex(event) }];
  });
}

function parseCosmosCoinList(rawAmount: string): ParsedCosmosCoin[] {
  return rawAmount
    .split(',')
    .map((part) => part.trim())
    .flatMap((part) => {
      const match = /^([0-9]+)(.+)$/.exec(part);
      const amountBaseUnits = match?.[1];
      const denom = match?.[2];
      if (!amountBaseUnits || !denom) {
        return [];
      }
      return [{ amountBaseUnits, denom }];
    });
}

function decimalAmountFromBaseUnits(amountBaseUnits: string, decimals: number): string {
  return parseDecimal(amountBaseUnits).div(Math.pow(10, decimals)).toFixed();
}

function displayCoinFromParsedCoin(coin: ParsedCosmosCoin, chainConfig: CosmosChainConfig): ParsedDisplayCoin {
  const denomFormatOptions = {
    nativeCurrency: chainConfig.nativeCurrency,
    nativeDenom: chainConfig.nativeDenom,
  };
  const isNativeDenom = coin.denom.toLowerCase() === chainConfig.nativeDenom.toLowerCase();
  const isIbcDenom = coin.denom.toLowerCase().startsWith('ibc/');
  const currency = formatDenom(coin.denom, denomFormatOptions);

  return {
    amount: decimalAmountFromBaseUnits(coin.amountBaseUnits, chainConfig.nativeDecimals),
    currency,
    tokenAddress: isNativeDenom ? undefined : coin.denom,
    tokenSymbol: currency,
    tokenType: isIbcDenom ? 'ibc' : 'native',
  };
}

function firstDisplayCoinFromAmount(rawAmount: string | undefined, chainConfig: CosmosChainConfig) {
  if (rawAmount === undefined) {
    return undefined;
  }
  const firstCoin = parseCosmosCoinList(rawAmount)[0];
  return firstCoin ? displayCoinFromParsedCoin(firstCoin, chainConfig) : undefined;
}

function nativeDisplayCoinFromAmount(rawAmount: string | undefined, chainConfig: CosmosChainConfig) {
  if (rawAmount === undefined) {
    return undefined;
  }
  const nativeCoin = parseCosmosCoinList(rawAmount).find((coin) => coin.denom === chainConfig.nativeDenom);
  return nativeCoin ? displayCoinFromParsedCoin(nativeCoin, chainConfig) : undefined;
}

function feeFromEvents(events: CosmosEvent[], chainConfig: CosmosChainConfig) {
  const feePayEvent = findEventsByType(events, 'fee_pay')[0];
  const feePayAmount = feePayEvent ? getAttributeValue(feePayEvent.event.attributes, 'fee') : undefined;
  const txEvent = findEventsByType(events, 'tx')[0];
  const txFeeAmount = txEvent ? getAttributeValue(txEvent.event.attributes, 'fee') : undefined;
  return nativeDisplayCoinFromAmount(feePayAmount ?? txFeeAmount, chainConfig);
}

function messageActionForIndex(events: CosmosEvent[], messageIndex: string | undefined): string | undefined {
  const messageEvents = findEventsByType(events, 'message');
  const exactMatch =
    messageIndex === undefined
      ? undefined
      : messageEvents.find((match) => match.messageIndex === messageIndex)?.event.attributes;
  const attributes = exactMatch ?? messageEvents[0]?.event.attributes;
  return attributes ? getFirstAttributeValue(attributes, ['action', 'message.action']) : undefined;
}

function messageTypeForTransferAction(action: string | undefined): string {
  if (action?.includes('MsgMultiSend')) {
    return BANK_MULTI_SEND_MESSAGE;
  }
  if (action?.includes('MsgTransfer')) {
    return IBC_TRANSFER_MESSAGE;
  }
  return BANK_SEND_MESSAGE;
}

function rewardForMessage(events: CosmosEvent[], messageIndex: string | undefined, chainConfig: CosmosChainConfig) {
  const rewardEvent = findEventsByType(events, 'withdraw_rewards').find(
    (match) => messageIndex === undefined || match.messageIndex === messageIndex
  );
  const rewardAmount = rewardEvent ? getAttributeValue(rewardEvent.event.attributes, 'amount') : undefined;
  return nativeDisplayCoinFromAmount(rewardAmount, chainConfig);
}

function mapRewardEvent(
  events: CosmosEvent[],
  relevantAddress: string,
  chainConfig: CosmosChainConfig
): MappedEventFields | undefined {
  const match = findEventsByType(events, 'withdraw_rewards').find((candidate) =>
    eventMatchesAddress(candidate.event, 'delegator', relevantAddress)
  );
  if (!match) {
    return undefined;
  }

  const reward = nativeDisplayCoinFromAmount(getAttributeValue(match.event.attributes, 'amount'), chainConfig);
  if (!reward) {
    logger.warn(
      { txMessageIndex: match.messageIndex },
      `Skipping staking reward event without native ${chainConfig.nativeDenom} reward amount`
    );
    return undefined;
  }

  const validator = getAttributeValue(match.event.attributes, 'validator') ?? '';

  return {
    amount: reward.amount,
    currency: reward.currency,
    from: validator,
    messageIndex: match.messageIndex,
    messageType: WITHDRAW_REWARD_MESSAGE,
    to: relevantAddress,
    tokenAddress: reward.tokenAddress,
    tokenSymbol: reward.tokenSymbol,
    tokenType: reward.tokenType,
    traceId: `event:${match.eventIndex}:reward:${match.messageIndex ?? 'unknown'}`,
    txType: 'staking_reward',
  };
}

function mapStakingOperationEvent(
  events: CosmosEvent[],
  relevantAddress: string,
  chainConfig: CosmosChainConfig
): MappedEventFields | undefined {
  const stakingEventCandidates = [
    { eventType: 'unbond', messageType: UNDELEGATE_MESSAGE, txType: 'staking_undelegate' },
    { eventType: 'delegate', messageType: DELEGATE_MESSAGE, txType: 'staking_delegate' },
    { eventType: 'redelegate', messageType: REDELEGATE_MESSAGE, txType: 'staking_redelegate' },
  ] as const;

  for (const candidate of stakingEventCandidates) {
    const match = findEventsByType(events, candidate.eventType).find((eventMatch) =>
      eventMatchesAddress(eventMatch.event, 'delegator', relevantAddress)
    );
    if (!match) {
      continue;
    }

    const reward = rewardForMessage(events, match.messageIndex, chainConfig);
    const principal = nativeDisplayCoinFromAmount(getAttributeValue(match.event.attributes, 'amount'), chainConfig);
    const sourceValidator =
      getAttributeValue(match.event.attributes, 'validator') ??
      getAttributeValue(match.event.attributes, 'source_validator') ??
      getAttributeValue(match.event.attributes, 'validator_src');
    const destinationValidator =
      getAttributeValue(match.event.attributes, 'destination_validator') ??
      getAttributeValue(match.event.attributes, 'validator_dst') ??
      sourceValidator;

    return {
      amount: reward?.amount ?? '0',
      currency: reward?.currency ?? chainConfig.nativeCurrency,
      from: candidate.eventType === 'delegate' ? relevantAddress : (sourceValidator ?? relevantAddress),
      messageIndex: match.messageIndex,
      messageType: candidate.messageType,
      stakingDestinationValidatorAddress: destinationValidator,
      stakingPrincipalAmount: principal?.amount,
      stakingPrincipalCurrency: principal?.currency,
      stakingPrincipalDenom: principal ? (principal.tokenAddress ?? chainConfig.nativeDenom) : undefined,
      stakingValidatorAddress: sourceValidator,
      to: candidate.eventType === 'delegate' ? (destinationValidator ?? relevantAddress) : relevantAddress,
      tokenAddress: reward?.tokenAddress,
      tokenSymbol: reward?.tokenSymbol ?? chainConfig.nativeCurrency,
      tokenType: reward?.tokenType ?? 'native',
      traceId: `event:${match.eventIndex}:${candidate.eventType}:${match.messageIndex ?? 'unknown'}`,
      txType: candidate.txType,
    };
  }

  return undefined;
}

function mapTransferEvent(
  events: CosmosEvent[],
  relevantAddress: string,
  chainConfig: CosmosChainConfig
): MappedEventFields | undefined {
  const relevantTransferEvents = findEventsByType(events, 'transfer').filter((match) => {
    const sender = getAttributeValue(match.event.attributes, 'sender')?.toLowerCase();
    const recipient = getAttributeValue(match.event.attributes, 'recipient')?.toLowerCase();
    return Boolean(sender && recipient && (sender === relevantAddress || recipient === relevantAddress));
  });

  const messageIndexedTransfers = relevantTransferEvents.filter((match) => match.messageIndex !== undefined);
  const transferCandidates = messageIndexedTransfers.length > 0 ? messageIndexedTransfers : relevantTransferEvents;

  for (const match of transferCandidates) {
    const sender = getAttributeValue(match.event.attributes, 'sender')?.toLowerCase();
    const recipient = getAttributeValue(match.event.attributes, 'recipient')?.toLowerCase();
    const coin = firstDisplayCoinFromAmount(getAttributeValue(match.event.attributes, 'amount'), chainConfig);
    if (!coin) {
      logger.warn(
        { txMessageIndex: match.messageIndex },
        'Skipping Cosmos transfer event without parseable amount attribute'
      );
      continue;
    }
    if (!sender || !recipient) {
      continue;
    }

    const messageAction = messageActionForIndex(events, match.messageIndex);
    const messageType = messageTypeForTransferAction(messageAction);
    const isIbcTransfer = messageType === IBC_TRANSFER_MESSAGE || coin.tokenType === 'ibc';
    const sourceChannelEvent = findEventsByType(events, 'send_packet').find(
      (eventMatch) => match.messageIndex === undefined || eventMatch.messageIndex === match.messageIndex
    );

    return {
      amount: coin.amount,
      bridgeType: isIbcTransfer ? 'ibc' : 'native',
      currency: coin.currency,
      from: sender,
      messageIndex: match.messageIndex,
      messageType,
      sourceChannel: sourceChannelEvent
        ? getAttributeValue(sourceChannelEvent.event.attributes, 'packet_src_channel')
        : undefined,
      sourcePort: sourceChannelEvent
        ? getAttributeValue(sourceChannelEvent.event.attributes, 'packet_src_port')
        : undefined,
      to: recipient,
      tokenAddress: coin.tokenAddress,
      tokenSymbol: coin.tokenSymbol,
      tokenType: coin.tokenType,
      traceId: `event:${match.eventIndex}:transfer:${match.messageIndex ?? 'unknown'}`,
    };
  }

  return undefined;
}

/**
 * Maps GetBlock's Tendermint tx_search result to the existing Cosmos normalized
 * transaction shape. GetBlock exposes indexed events, not decoded Cosmos SDK
 * message bodies, so this mapper intentionally derives only the cases that are
 * supported by event data.
 */
export function mapGetBlockCosmosTransaction(
  rawData: GetBlockHydratedTx,
  relevantAddress: string,
  providerName: string,
  chainConfig: CosmosChainConfig
): Result<CosmosTransaction, NormalizationError> {
  const address = relevantAddress.toLowerCase();
  if (!address) {
    return err({ message: 'Invalid address', type: 'error' });
  }

  const events = rawData.tx_result.events ?? [];
  const mapped =
    mapStakingOperationEvent(events, address, chainConfig) ??
    mapRewardEvent(events, address, chainConfig) ??
    mapTransferEvent(events, address, chainConfig);

  if (!mapped) {
    return err({
      reason: `No relevant supported event found in transaction ${rawData.hash} for address ${relevantAddress}`,
      type: 'skip',
    });
  }

  const timestamp = new Date(rawData.timestamp).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return err({
      message: `Invalid block timestamp for transaction ${rawData.hash}: ${rawData.timestamp}`,
      type: 'error',
    });
  }

  const blockHeight = parseInt(rawData.height, 10);
  if (!Number.isFinite(blockHeight)) {
    return err({
      message: `Invalid block height for transaction ${rawData.hash}: ${rawData.height}`,
      type: 'error',
    });
  }

  const fee = feeFromEvents(events, chainConfig);
  const status = rawData.tx_result.code === 0 || rawData.tx_result.code === undefined ? 'success' : 'failed';

  const transaction: CosmosTransaction = {
    amount: mapped.amount,
    blockHeight,
    blockId: rawData.height,
    bridgeType: mapped.bridgeType,
    currency: mapped.currency,
    eventId: generateUniqueTransactionEventId({
      amount: mapped.amount,
      currency: mapped.currency,
      from: mapped.from,
      id: rawData.hash,
      timestamp,
      to: mapped.to,
      tokenAddress: mapped.tokenAddress,
      traceId: mapped.traceId,
      type: mapped.messageType,
    }),
    feeAmount: fee?.amount,
    feeCurrency: fee?.currency,
    from: mapped.from,
    gasUsed: rawData.tx_result.gas_used ? parseInt(rawData.tx_result.gas_used, 10) : undefined,
    gasWanted: rawData.tx_result.gas_wanted ? parseInt(rawData.tx_result.gas_wanted, 10) : undefined,
    id: rawData.hash,
    messageType: mapped.messageType,
    providerName,
    sourceChannel: mapped.sourceChannel,
    sourcePort: mapped.sourcePort,
    status,
    stakingDestinationValidatorAddress: mapped.stakingDestinationValidatorAddress,
    stakingPrincipalAmount: mapped.stakingPrincipalAmount,
    stakingPrincipalCurrency: mapped.stakingPrincipalCurrency,
    stakingPrincipalDenom: mapped.stakingPrincipalDenom,
    stakingValidatorAddress: mapped.stakingValidatorAddress,
    timestamp,
    to: mapped.to,
    tokenAddress: mapped.tokenAddress,
    tokenSymbol: mapped.tokenSymbol,
    tokenType: mapped.tokenType,
    txType: mapped.txType,
  };

  return validateOutput(transaction, CosmosTransactionSchema, 'GetBlockCosmosTransaction');
}
