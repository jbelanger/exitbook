import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { type Result, err } from 'neverthrow';

import { generateUniqueTransactionEventId, type NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { COSMOS_CHAINS } from '../../chain-registry.js';
import {
  parseBankMultiSendMessage,
  parseBankSendMessage,
  parseIbcTransferMessage,
  shouldSkipMessage,
} from '../../message-parser-utils.js';
import { CosmosTransactionSchema } from '../../schemas.js';
import type { CosmosTransaction } from '../../types.js';
import { formatDenom, isTransactionRelevant } from '../../utils.js';

import type { AkashTransactionDetail } from './akash-console.schemas.js';

/**
 * Pure function for Akash Console API transaction mapping
 * Input is already validated by HTTP client, output validated here
 * Following the Functional Core / Imperative Shell pattern
 */
export function mapAkashConsoleTransaction(
  rawData: AkashTransactionDetail,
  relevantAddress: string
): Result<CosmosTransaction, NormalizationError> {
  const logger = getLogger('AkashConsoleMapperUtils');

  // Get Akash chain config for denom formatting
  const chainConfig = COSMOS_CHAINS['akash'] as CosmosChainConfig;
  const formatDenomOptions = {
    nativeCurrency: chainConfig.nativeCurrency,
    nativeDenom: chainConfig.nativeDenom,
  };

  // Validate relevantAddress is provided
  if (!relevantAddress || relevantAddress.trim() === '') {
    return err({
      message: 'Invalid address',
      type: 'error',
    });
  }

  const timestamp = new Date(rawData.datetime).getTime();
  const transactionHash = rawData.hash;

  // Convert fee from base units (uakt) to decimal (AKT)
  const feeAmount =
    rawData.fee > 0
      ? parseDecimal(rawData.fee.toString()).div(Math.pow(10, chainConfig.nativeDecimals)).toFixed()
      : '0';
  const feeCurrency = chainConfig.nativeCurrency;

  // Initialize transaction fields
  let amount = '0';
  let from = '';
  let to = '';
  let currency = 'AKT';
  let messageType: string | undefined;
  let bridgeType: 'peggy' | 'ibc' | 'native' | undefined;
  let sourceChannel: string | undefined;
  let sourcePort: string | undefined;
  let tokenAddress: string | undefined;
  let tokenSymbol: string | undefined;
  let tokenType: 'cw20' | 'native' | 'ibc' | undefined;
  let selectedMessageIndex: number | undefined;

  // Parse messages to extract transfer information
  for (const [messageIndex, message] of rawData.messages.entries()) {
    messageType = message.type;

    // Check if message should be skipped
    const skipReason = shouldSkipMessage(message.type);
    if (skipReason) {
      logger.debug(`Skipping non-transfer message: ${message.type} in tx ${transactionHash}. Reason: ${skipReason}`);
      continue;
    }

    // Convert Akash Console message format to the format expected by message parsers
    const convertedMessage = {
      type: message.type,
      value: message.data,
    };

    // Try parsing as bank send message
    const bankResult = parseBankSendMessage(convertedMessage, chainConfig.nativeDecimals);
    if (bankResult) {
      from = bankResult.from;
      to = bankResult.to;
      amount = bankResult.amount;
      currency = formatDenom(bankResult.currency, formatDenomOptions);
      tokenType = bankResult.tokenType;
      tokenSymbol = currency;
      bridgeType = 'native';

      if (!isTransactionRelevant(from, to, relevantAddress, amount)) {
        logger.debug(
          `Skipping message not relevant to wallet. MessageType="${messageType}", relevantAddress="${relevantAddress}", from="${from}", to="${to}", tx=${transactionHash}`
        );
        continue;
      }
      selectedMessageIndex = messageIndex;
      break;
    }

    // Try parsing as bank multi-send message
    const bankMultiSendResult = parseBankMultiSendMessage(
      convertedMessage,
      relevantAddress,
      chainConfig.nativeDecimals
    );
    if (bankMultiSendResult) {
      from = bankMultiSendResult.from;
      to = bankMultiSendResult.to;
      amount = bankMultiSendResult.amount;
      currency = formatDenom(bankMultiSendResult.currency, formatDenomOptions);
      tokenType = bankMultiSendResult.tokenType;
      tokenSymbol = currency;
      bridgeType = 'native';

      if (!isTransactionRelevant(from, to, relevantAddress, amount)) {
        logger.debug(
          `Skipping message not relevant to wallet. MessageType="${messageType}", relevantAddress="${relevantAddress}", from="${from}", to="${to}", tx=${transactionHash}`
        );
        continue;
      }
      selectedMessageIndex = messageIndex;
      break;
    }

    // Try parsing as IBC transfer message
    const ibcResult = parseIbcTransferMessage(convertedMessage, chainConfig.nativeDecimals);
    if (ibcResult) {
      from = ibcResult.from;
      to = ibcResult.to;
      amount = ibcResult.amount;
      currency = formatDenom(ibcResult.currency, formatDenomOptions);
      tokenType = ibcResult.tokenType;
      tokenSymbol = currency;
      bridgeType = 'ibc';
      sourceChannel = ibcResult.sourceChannel;
      sourcePort = ibcResult.sourcePort;
      tokenAddress = ibcResult.currency;

      if (!isTransactionRelevant(from, to, relevantAddress, amount)) {
        logger.debug(
          `Skipping message not relevant to wallet. MessageType="${messageType}", relevantAddress="${relevantAddress}", from="${from}", to="${to}", tx=${transactionHash}`
        );
        continue;
      }
      selectedMessageIndex = messageIndex;
      break;
    }

    // Unsupported message type
    logger.debug(`Skipping unsupported message type "${message.type}" in transaction ${transactionHash}.`);
    continue;
  }

  if (selectedMessageIndex === undefined) {
    return err({
      reason: `No relevant transfer messages found in transaction ${transactionHash} for address ${relevantAddress}`,
      type: 'skip',
    });
  }

  const transaction: CosmosTransaction = {
    amount,
    blockHeight: rawData.height,
    bridgeType,
    currency,
    eventId: generateUniqueTransactionEventId({
      amount,
      currency,
      from,
      id: transactionHash,
      timestamp,
      to,
      tokenAddress,
      traceId: `msg:${selectedMessageIndex}`,
      type: messageType || 'transfer',
    }),
    feeAmount: feeAmount !== '0' ? feeAmount : undefined,
    feeCurrency: feeAmount !== '0' ? feeCurrency : undefined,
    from,
    gasUsed: rawData.gasUsed,
    gasWanted: rawData.gasWanted,
    id: transactionHash,
    memo: rawData.memo || undefined,
    messageType,
    providerName: 'akash-console',
    sourceChannel,
    sourcePort,
    status: rawData.isSuccess ? 'success' : 'failed',
    timestamp,
    to,
    tokenAddress,
    tokenSymbol,
    tokenType,
  };

  return validateOutput(transaction, CosmosTransactionSchema, 'AkashConsoleTransaction');
}
