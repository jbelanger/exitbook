import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { type Result, err } from 'neverthrow';

import { generateUniqueTransactionEventId, type NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import { calculateFee } from '../../calculation-utils.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import {
  parseBankMultiSendMessage,
  parseBankSendMessage,
  parseCosmwasmExecuteMessage,
  parseIbcTransferMessage,
  shouldSkipMessage,
} from '../../message-parser-utils.js';
import { CosmosTransactionSchema } from '../../schemas.js';
import type { CosmosTransaction } from '../../types.js';
import { formatDenom, isTransactionRelevant } from '../../utils.js';

import type { CosmosMessage, CosmosTxResponse, CosmosEvent, CosmosEventAttribute } from './cosmos-rest.schemas.js';

/**
 * Convert Cosmos REST API message format to Injective message format
 * that the existing parsers expect
 */
function convertMessageFormat(message: CosmosMessage): {
  type: string;
  value: Record<string, unknown>;
} {
  const { '@type': type, ...value } = message;
  return { type, value };
}

/**
 * Extract attribute value from event attributes by key
 */
function getAttributeValue(attributes: CosmosEventAttribute[], key: string): string | undefined {
  const attr = attributes.find((a) => a.key === key);
  return attr?.value;
}

/**
 * Extract sender and recipient from transaction events
 * This is useful when messages don't contain explicit from/to addresses
 */
function extractAddressesFromEvents(
  events: CosmosEvent[] | undefined,
  _relevantAddress: string
): { recipient?: string; sender?: string } {
  if (!events) return {};

  for (const event of events) {
    if (event.type === 'transfer' || event.type === 'coin_spent' || event.type === 'coin_received') {
      const sender = getAttributeValue(event.attributes, 'sender');
      const recipient = getAttributeValue(event.attributes, 'recipient');

      if (sender && recipient) {
        return { sender, recipient };
      }
    }
  }

  return {};
}

/**
 * Pure function for Cosmos REST API transaction mapping
 * Maps standard Cosmos SDK REST API responses to normalized CosmosTransaction format
 * Compatible with all Cosmos chains (Fetch.ai, Osmosis, Cosmos Hub, etc.)
 */
export function mapCosmosRestTransaction(
  rawData: CosmosTxResponse,
  relevantAddress: string,
  providerName: string,
  chainConfig: CosmosChainConfig
): Result<CosmosTransaction, NormalizationError> {
  const logger = getLogger('CosmosRestMapperUtils');
  const denomFormatOptions = {
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

  // Parse timestamp
  const timestamp = new Date(rawData.timestamp).getTime();
  const transactionHash = rawData.txhash;
  const blockHeight = parseInt(rawData.height, 10);

  // Extract messages from transaction body
  const messages = rawData.tx?.body?.messages ?? [];
  if (messages.length === 0) {
    return err({
      reason: `No messages found in transaction ${transactionHash}`,
      type: 'skip',
    });
  }

  // Calculate fee using pure function
  const feeData = rawData.tx?.auth_info?.fee;
  // Convert Cosmos REST API fee format to InjectiveGasFee format
  const feeForCalculation = feeData
    ? {
        amount: feeData.amount,
        gas_limit: parseInt(feeData.gas_limit, 10),
        granter: feeData.granter,
        payer: feeData.payer,
      }
    : undefined;
  const feeResult = feeForCalculation ? calculateFee(feeForCalculation, chainConfig.nativeDecimals) : undefined;
  const feeAmount = feeResult?.feeAmount ?? '0';
  const feeCurrency = feeResult ? formatDenom(feeResult.feeCurrency, denomFormatOptions) : undefined;

  // Extract gas information
  const gasUsed = rawData.gas_used ? parseInt(rawData.gas_used, 10) : undefined;
  const gasWanted = rawData.gas_wanted ? parseInt(rawData.gas_wanted, 10) : undefined;

  // Initialize transaction fields
  let amount = '0';
  let from = '';
  let to = '';
  let currency = '';
  let messageType: string | undefined;
  let bridgeType: 'peggy' | 'ibc' | 'native' | undefined;
  let sourceChannel: string | undefined;
  let sourcePort: string | undefined;
  let tokenAddress: string | undefined;
  let tokenSymbol: string | undefined;
  let tokenType: 'cw20' | 'native' | 'ibc' | undefined;
  let selectedMessageIndex: number | undefined;

  // Parse messages to extract transfer information
  for (const [messageIndex, cosmosMessage] of messages.entries()) {
    messageType = cosmosMessage['@type'];

    // Check if message should be skipped
    const skipReason = shouldSkipMessage(messageType);
    if (skipReason) {
      logger.debug(`Skipping non-transfer message: ${messageType} in tx ${transactionHash}. Reason: ${skipReason}`);
      continue;
    }

    // Convert message format for existing parsers
    const message = convertMessageFormat(cosmosMessage);

    // Try parsing as bank send message
    const bankResult = parseBankSendMessage(message, chainConfig.nativeDecimals);
    if (bankResult) {
      from = bankResult.from;
      to = bankResult.to;
      amount = bankResult.amount;
      currency = formatDenom(bankResult.currency, denomFormatOptions);
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
    const bankMultiSendResult = parseBankMultiSendMessage(message, relevantAddress, chainConfig.nativeDecimals);
    if (bankMultiSendResult) {
      from = bankMultiSendResult.from;
      to = bankMultiSendResult.to;
      amount = bankMultiSendResult.amount;
      currency = formatDenom(bankMultiSendResult.currency, denomFormatOptions);
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
    const ibcResult = parseIbcTransferMessage(message, chainConfig.nativeDecimals);
    if (ibcResult) {
      from = ibcResult.from;
      to = ibcResult.to;
      amount = ibcResult.amount;
      currency = formatDenom(ibcResult.currency, denomFormatOptions);
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

    // Try parsing as CosmWasm contract execution
    const cosmwasmResult = parseCosmwasmExecuteMessage(message, chainConfig.nativeDecimals);
    if (cosmwasmResult) {
      from = cosmwasmResult.from;
      to = cosmwasmResult.to;
      amount = cosmwasmResult.amount;
      currency = formatDenom(cosmwasmResult.currency, denomFormatOptions);
      tokenType = cosmwasmResult.tokenType;
      tokenSymbol = currency;

      // Only relevant if user is the sender
      if (from !== relevantAddress) {
        logger.debug(
          `Skipping contract execution not relevant - sender is not the wallet address. sender="${from}", relevantAddress="${relevantAddress}", tx=${transactionHash}`
        );
        continue;
      }
      selectedMessageIndex = messageIndex;
      break;
    }

    // Try extracting from events if message parsing failed
    const { sender, recipient } = extractAddressesFromEvents(rawData.events, relevantAddress);
    if (sender && recipient) {
      from = sender;
      to = recipient;
      // Try to get amount from first coin in message if available
      if (cosmosMessage.amount && Array.isArray(cosmosMessage.amount) && cosmosMessage.amount.length > 0) {
        const firstAmount = cosmosMessage.amount[0];
        if (firstAmount) {
          // Apply decimal conversion (same as other parsers)
          amount = parseDecimal(firstAmount.amount).div(Math.pow(10, chainConfig.nativeDecimals)).toFixed();
          currency = formatDenom(firstAmount.denom, denomFormatOptions);
          tokenType = 'native';
          tokenSymbol = currency;

          if (isTransactionRelevant(from, to, relevantAddress, amount)) {
            selectedMessageIndex = messageIndex;
            break;
          }
        }
      }
    }

    // Unsupported message type
    logger.debug(`Skipping unsupported message type "${messageType}" in transaction ${transactionHash}.`);
    continue;
  }

  if (selectedMessageIndex === undefined) {
    return err({
      reason: `No relevant transfer messages found in transaction ${transactionHash} for address ${relevantAddress}`,
      type: 'skip',
    });
  }

  // Get memo from transaction body
  const memo = rawData.tx?.body?.memo;

  // Determine transaction status (code 0 = success)
  const status = rawData.code === 0 || rawData.code === undefined ? 'success' : 'failed';

  const transaction: CosmosTransaction = {
    amount,
    blockHeight,
    blockId: rawData.height,
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
    gasUsed,
    gasWanted,
    id: transactionHash,
    memo: memo && memo.trim() !== '' ? memo : undefined,
    messageType,
    providerName,
    sourceChannel,
    sourcePort,
    status,
    timestamp,
    to,
    tokenAddress,
    tokenDecimals: undefined,
    tokenSymbol,
    tokenType,
  };

  return validateOutput(transaction, CosmosTransactionSchema, 'CosmosRestTransaction');
}
