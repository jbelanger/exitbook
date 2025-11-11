import type { SourceMetadata } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { type Result, err } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import { calculateFee } from '../../calculation-utils.js';
import {
  parseBankSendMessage,
  parseCosmwasmExecuteMessage,
  parseIbcTransferMessage,
  parsePeggyDepositClaimMessage,
  parsePeggySendToEthMessage,
  parseWasmxExecuteMessage,
  shouldSkipMessage,
} from '../../message-parser-utils.js';
import { CosmosTransactionSchema } from '../../schemas.js';
import type { CosmosTransaction } from '../../types.js';
import { formatDenom, generatePeggyId, isTransactionRelevant } from '../../utils.js';

import type { InjectiveTransaction as InjectiveApiTransaction } from './injective-explorer.schemas.js';

/**
 * Pure function for Injective Explorer transaction mapping
 * Input is already validated by HTTP client, output validated here
 * Following the Functional Core / Imperative Shell pattern
 */
export function mapInjectiveExplorerTransaction(
  rawData: InjectiveApiTransaction,
  sourceContext: SourceMetadata
): Result<CosmosTransaction, NormalizationError> {
  const logger = getLogger('InjectiveExplorerMapperUtils');
  const timestamp = rawData.block_timestamp.getTime();

  if (!sourceContext.address) {
    return err({ message: 'Invalid address', type: 'error' });
  }

  const relevantAddress = sourceContext.address;

  // Calculate fee using pure function
  const feeResult = calculateFee(rawData.gas_fee);
  const feeAmount = feeResult?.feeAmount ?? '0';
  const feeCurrency = feeResult ? formatDenom(feeResult.feeCurrency) : 'INJ';

  // Initialize transaction fields
  let amount = '0';
  let from = '';
  let to = '';
  let currency = 'INJ';
  let messageType: string | undefined;
  let bridgeType: 'peggy' | 'ibc' | 'native' | undefined;
  let eventNonce: string | undefined;
  let sourceChannel: string | undefined;
  let sourcePort: string | undefined;
  let ethereumSender: string | undefined;
  let ethereumReceiver: string | undefined;
  let tokenAddress: string | undefined;
  let tokenDecimals: number | undefined;
  let tokenSymbol: string | undefined;
  let tokenType: 'cw20' | 'native' | 'ibc' | undefined;

  // Parse messages to extract transfer information
  for (const message of rawData.messages) {
    messageType = message.type;

    // Check if message should be skipped
    const skipReason = shouldSkipMessage(message.type);
    if (skipReason) {
      logger.debug(`Skipping message: ${message.type} in tx ${rawData.hash}`);
      return err({ reason: skipReason, type: 'skip' });
    }

    // Try parsing as bank send message
    const bankResult = parseBankSendMessage(message);
    if (bankResult) {
      from = bankResult.from;
      to = bankResult.to;
      amount = bankResult.amount;
      currency = formatDenom(bankResult.currency);
      tokenType = bankResult.tokenType;
      tokenSymbol = currency;
      bridgeType = 'native';

      if (!isTransactionRelevant(from, to, relevantAddress, amount)) {
        return err({
          reason: `Transaction not relevant to wallet. MessageType="${messageType}", relevantAddress="${relevantAddress}", from="${from}", to="${to}"`,
          type: 'skip',
        });
      }
      break;
    }

    // Try parsing as IBC transfer message
    const ibcResult = parseIbcTransferMessage(message);
    if (ibcResult) {
      from = ibcResult.from;
      to = ibcResult.to;
      amount = ibcResult.amount;
      currency = formatDenom(ibcResult.currency);
      tokenType = ibcResult.tokenType;
      tokenSymbol = currency;
      bridgeType = 'ibc';
      sourceChannel = ibcResult.sourceChannel;
      sourcePort = ibcResult.sourcePort;

      if (!isTransactionRelevant(from, to, relevantAddress, amount)) {
        return err({
          reason: `Transaction not relevant to wallet. MessageType="${messageType}", relevantAddress="${relevantAddress}", from="${from}", to="${to}"`,
          type: 'skip',
        });
      }
      break;
    }

    // Try parsing as CosmWasm contract execution
    const cosmwasmResult = parseCosmwasmExecuteMessage(message);
    if (cosmwasmResult) {
      from = cosmwasmResult.from;
      to = cosmwasmResult.to;
      amount = cosmwasmResult.amount;
      currency = formatDenom(cosmwasmResult.currency);
      tokenType = cosmwasmResult.tokenType;
      tokenSymbol = currency;

      // Only relevant if user is the sender
      if (from !== relevantAddress) {
        return err({
          reason: `Contract execution not relevant - sender is not the wallet address`,
          type: 'skip',
        });
      }
      break;
    }

    // Try parsing as Injective wasmx contract execution
    const wasmxResult = parseWasmxExecuteMessage(message);
    if (wasmxResult) {
      from = wasmxResult.from;
      to = wasmxResult.to;
      amount = wasmxResult.amount;
      currency = formatDenom(wasmxResult.currency);
      tokenType = wasmxResult.tokenType;
      tokenSymbol = currency;

      // Only relevant if user is the sender
      if (from !== relevantAddress) {
        return err({
          reason: `Wasmx execution not relevant - sender is not the wallet address`,
          type: 'skip',
        });
      }
      break;
    }

    // Try parsing as Peggy withdrawal message
    const peggyWithdrawalResult = parsePeggySendToEthMessage(message);
    if (peggyWithdrawalResult) {
      from = peggyWithdrawalResult.from;
      to = peggyWithdrawalResult.to;
      amount = peggyWithdrawalResult.amount;
      currency = formatDenom(peggyWithdrawalResult.currency);
      tokenType = peggyWithdrawalResult.tokenType;
      tokenSymbol = currency;
      bridgeType = peggyWithdrawalResult.bridgeType;
      ethereumReceiver = peggyWithdrawalResult.ethereumReceiver;

      // Only relevant if user is the sender
      if (from !== relevantAddress) {
        return err({
          reason: `Peggy withdrawal not relevant - sender is not the wallet address`,
          type: 'skip',
        });
      }
      break;
    }

    // Try parsing as Peggy deposit message
    const peggyDepositResult = parsePeggyDepositClaimMessage(message, relevantAddress);
    if (peggyDepositResult) {
      from = peggyDepositResult.from;
      to = peggyDepositResult.to;
      amount = peggyDepositResult.amount;
      currency = formatDenom(peggyDepositResult.currency);
      tokenType = peggyDepositResult.tokenType;
      tokenSymbol = currency;
      bridgeType = peggyDepositResult.bridgeType;
      eventNonce = peggyDepositResult.eventNonce;
      ethereumSender = peggyDepositResult.ethereumSender;
      ethereumReceiver = peggyDepositResult.ethereumReceiver;
      tokenAddress = peggyDepositResult.tokenAddress;
      break;
    }

    // Unsupported message type
    logger.debug(`Skipping unsupported message type "${message.type}" in transaction ${rawData.hash}.`);
    return err({
      reason: `Unsupported message type ${message.type}`,
      type: 'skip',
    });
  }

  // Generate unique transaction ID (handles Peggy deposit deduplication)
  const transactionId = generatePeggyId(eventNonce, rawData.claim_id, rawData.hash);

  const transaction: CosmosTransaction = {
    amount,
    blockHeight: rawData.block_number,
    bridgeType,
    claimId: rawData.claim_id,
    currency,
    ethereumReceiver,
    ethereumSender,
    eventNonce,
    feeAmount: feeAmount !== '0' ? feeAmount : undefined,
    feeCurrency: feeAmount !== '0' ? feeCurrency : undefined,
    from,
    gasUsed: rawData.gas_used,
    gasWanted: rawData.gas_wanted,
    id: transactionId,
    memo: rawData.memo,
    messageType,
    providerName: 'injective-explorer',
    sourceChannel,
    sourcePort,
    status: rawData.code === 0 ? 'success' : 'failed',
    timestamp,
    to,
    tokenAddress,
    tokenDecimals,
    tokenSymbol,
    tokenType,
    txType: rawData.tx_type,
  };

  return validateOutput(transaction, CosmosTransactionSchema, 'InjectiveExplorerTransaction');
}
