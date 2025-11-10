/**
 * Pure functions for parsing Cosmos SDK message types
 *
 * Each parser function handles a specific Cosmos SDK message type and extracts
 * relevant transfer information. Returns undefined if the message doesn't match
 * the expected type.
 *
 * Supported message types:
 * - Bank transfers (MsgSend)
 * - IBC transfers (MsgTransfer)
 * - CosmWasm contract execution (MsgExecuteContract)
 * - Injective wasmx contract execution (MsgExecuteContractCompat)
 * - Peggy bridge withdrawals (MsgSendToEth)
 * - Peggy bridge deposits (MsgDepositClaim)
 */
import { parseDecimal } from '@exitbook/core';

import type {
  InjectiveMessage,
  InjectiveMessageValue,
  InjectiveAmount,
} from './providers/injective-explorer/injective-explorer.schemas.js';

/**
 * Result from parsing a bank send message
 */
export interface BankSendResult {
  from: string;
  to: string;
  amount: string;
  currency: string;
  tokenType: 'native';
  tokenSymbol: string;
}

/**
 * Result from parsing an IBC transfer message
 */
export interface IbcTransferResult {
  from: string;
  to: string;
  amount: string;
  currency: string;
  tokenType: 'ibc';
  tokenSymbol: string;
  sourceChannel: string | undefined;
  sourcePort: string | undefined;
}

/**
 * Result from parsing a CosmWasm contract execution message
 */
export interface CosmwasmExecuteResult {
  from: string;
  to: string;
  amount: string;
  currency: string;
  tokenType: 'native';
  tokenSymbol: string;
}

/**
 * Result from parsing an Injective wasmx contract execution message
 */
export interface WasmxExecuteResult {
  from: string;
  to: string;
  amount: string;
  currency: string;
  tokenType: 'native';
  tokenSymbol: string;
}

/**
 * Result from parsing a Peggy bridge withdrawal message
 */
export interface PeggySendToEthResult {
  bridgeType: 'peggy';
  from: string;
  to: string;
  amount: string;
  currency: string;
  tokenType: 'native';
  tokenSymbol: string;
  ethereumReceiver: string | undefined;
}

/**
 * Result from parsing a Peggy bridge deposit message
 */
export interface PeggyDepositClaimResult {
  bridgeType: 'peggy';
  from: string;
  to: string;
  amount: string;
  currency: string;
  tokenType: 'native';
  tokenSymbol: string;
  eventNonce: string | undefined;
  ethereumSender: string | undefined;
  ethereumReceiver: string | undefined;
  tokenAddress: string | undefined;
}

/**
 * Parse a bank send message (/cosmos.bank.v1beta1.MsgSend)
 *
 * Extracts transfer information from a standard Cosmos SDK bank transfer.
 *
 * @param message - Message to parse
 * @param decimals - Number of decimals for amount conversion (default: 18)
 * @returns Parsed transfer data, or undefined if not a bank send message
 */
export function parseBankSendMessage(message: InjectiveMessage, decimals = 18): BankSendResult | undefined {
  if (message.type !== '/cosmos.bank.v1beta1.MsgSend') {
    return undefined;
  }

  const from = message.value.from_address || '';
  const to = message.value.to_address || '';

  if (!message.value.amount || !Array.isArray(message.value.amount) || message.value.amount.length === 0) {
    return undefined;
  }

  const transferAmount = message.value.amount[0];
  if (!transferAmount) {
    return undefined;
  }

  const amount = parseDecimal(transferAmount.amount).div(Math.pow(10, decimals)).toFixed();
  const currency = transferAmount.denom;

  return {
    from,
    to,
    amount,
    currency,
    tokenType: 'native',
    tokenSymbol: currency,
  };
}

/**
 * Parse an IBC transfer message (/ibc.applications.transfer.v1.MsgTransfer)
 *
 * Extracts transfer information from an IBC cross-chain transfer.
 *
 * @param message - Message to parse
 * @param decimals - Number of decimals for amount conversion (default: 18)
 * @returns Parsed transfer data, or undefined if not an IBC transfer message
 */
export function parseIbcTransferMessage(message: InjectiveMessage, decimals = 18): IbcTransferResult | undefined {
  if (message.type !== '/ibc.applications.transfer.v1.MsgTransfer') {
    return undefined;
  }

  const from = message.value.sender || '';
  const to = message.value.receiver || '';

  if (!message.value.token) {
    return undefined;
  }

  const amount = parseDecimal(message.value.token.amount).div(Math.pow(10, decimals)).toFixed();
  const currency = message.value.token.denom;

  return {
    from,
    to,
    amount,
    currency,
    tokenType: 'ibc',
    tokenSymbol: currency,
    sourceChannel: message.value.source_channel,
    sourcePort: message.value.source_port,
  };
}

/**
 * Parse a CosmWasm contract execution message (/cosmwasm.wasm.v1.MsgExecuteContract)
 *
 * Extracts funds sent with a contract call (not internal contract transfers).
 *
 * @param message - Message to parse
 * @param decimals - Number of decimals for amount conversion (default: 18)
 * @returns Parsed contract execution data, or undefined if not a CosmWasm message
 */
export function parseCosmwasmExecuteMessage(
  message: InjectiveMessage,
  decimals = 18
): CosmwasmExecuteResult | undefined {
  if (message.type !== '/cosmwasm.wasm.v1.MsgExecuteContract') {
    return undefined;
  }

  const from = message.value.sender || '';
  const to = message.value.contract || '';

  // Check if funds were sent with the contract call
  if (!message.value.funds || !Array.isArray(message.value.funds) || message.value.funds.length === 0) {
    // No funds sent with contract call, but still a valid execution
    return {
      from,
      to,
      amount: '0',
      currency: 'INJ',
      tokenType: 'native',
      tokenSymbol: 'INJ',
    };
  }

  const fund = message.value.funds[0];
  if (!fund?.amount || !fund.denom) {
    return {
      from,
      to,
      amount: '0',
      currency: 'INJ',
      tokenType: 'native',
      tokenSymbol: 'INJ',
    };
  }

  const amount = parseDecimal(fund.amount).div(Math.pow(10, decimals)).toFixed();
  const currency = fund.denom;

  return {
    from,
    to,
    amount,
    currency,
    tokenType: 'native',
    tokenSymbol: currency,
  };
}

/**
 * Parse an Injective wasmx contract execution message (/injective.wasmx.v1.MsgExecuteContractCompat)
 *
 * Extracts funds sent with an Injective-specific contract call.
 * Funds are provided as a string in wasmx (unlike array in standard CosmWasm).
 *
 * @param message - Message to parse
 * @param decimals - Number of decimals for amount conversion (default: 18)
 * @returns Parsed contract execution data, or undefined if not a wasmx message
 */
export function parseWasmxExecuteMessage(message: InjectiveMessage, decimals = 18): WasmxExecuteResult | undefined {
  if (message.type !== '/injective.wasmx.v1.MsgExecuteContractCompat') {
    return undefined;
  }

  const from = message.value.sender || '';
  const to = message.value.contract || '';

  // Extract funds (string format in wasmx)
  if (!message.value.funds || typeof message.value.funds !== 'string') {
    return {
      from,
      to,
      amount: '0',
      currency: 'INJ',
      tokenType: 'native',
      tokenSymbol: 'INJ',
    };
  }

  const fundsValue = parseDecimal(message.value.funds);
  if (fundsValue.toNumber() <= 0) {
    return {
      from,
      to,
      amount: '0',
      currency: 'INJ',
      tokenType: 'native',
      tokenSymbol: 'INJ',
    };
  }

  const amount = fundsValue.div(Math.pow(10, decimals)).toFixed();

  return {
    from,
    to,
    amount,
    currency: 'INJ',
    tokenType: 'native',
    tokenSymbol: 'INJ',
  };
}

/**
 * Parse a Peggy bridge withdrawal message (/injective.peggy.v1.MsgSendToEth)
 *
 * Extracts information about sending funds from Injective to Ethereum.
 *
 * @param message - Message to parse
 * @param decimals - Number of decimals for amount conversion (default: 18)
 * @returns Parsed withdrawal data, or undefined if not a Peggy withdrawal message
 */
export function parsePeggySendToEthMessage(message: InjectiveMessage, decimals = 18): PeggySendToEthResult | undefined {
  if (message.type !== '/injective.peggy.v1.MsgSendToEth') {
    return undefined;
  }

  const messageValue = message.value as InjectiveMessageValue & {
    amount?: InjectiveAmount | undefined;
    bridge_fee?: InjectiveAmount | undefined;
    eth_dest?: string | undefined;
  };

  const from = messageValue.sender || '';
  const to = messageValue.eth_dest || '';

  if (!messageValue.amount?.amount || !messageValue.amount.denom) {
    return undefined;
  }

  const amount = parseDecimal(messageValue.amount.amount).div(Math.pow(10, decimals)).toFixed();
  const currency = messageValue.amount.denom;

  return {
    bridgeType: 'peggy',
    from,
    to,
    amount,
    currency,
    tokenType: 'native',
    tokenSymbol: currency,
    ethereumReceiver: messageValue.eth_dest,
  };
}

/**
 * Parse a Peggy bridge deposit message (/injective.peggy.v1.MsgDepositClaim)
 *
 * Extracts information about funds coming from Ethereum to Injective.
 * Handles multiple amount formats (string, array, object).
 *
 * @param message - Message to parse
 * @param relevantAddress - Address to check for relevance
 * @param decimals - Number of decimals for amount conversion (default: 18)
 * @returns Parsed deposit data, or undefined if not a Peggy deposit or not relevant
 */
export function parsePeggyDepositClaimMessage(
  message: InjectiveMessage,
  relevantAddress: string,
  decimals = 18
): PeggyDepositClaimResult | undefined {
  if (message.type !== '/injective.peggy.v1.MsgDepositClaim') {
    return undefined;
  }

  const messageValue = message.value as InjectiveMessageValue & {
    cosmos_receiver?: string | undefined;
    ethereum_receiver?: string | undefined;
    ethereum_sender?: string | undefined;
    event_nonce?: string | undefined;
  };

  const isRelevant =
    (messageValue.ethereum_receiver && relevantAddress === messageValue.ethereum_receiver) ||
    (messageValue.cosmos_receiver && relevantAddress === messageValue.cosmos_receiver);

  if (!isRelevant) {
    return undefined;
  }

  const from = messageValue.ethereum_sender || '';
  const to = messageValue.cosmos_receiver || messageValue.ethereum_receiver || '';

  // Extract amount - handles multiple formats
  let amountValue = '0';
  if (messageValue.amount && messageValue.token_contract) {
    if (typeof messageValue.amount === 'string') {
      amountValue = messageValue.amount;
    } else if (
      Array.isArray(messageValue.amount) &&
      messageValue.amount.length > 0 &&
      typeof messageValue.amount[0]?.amount === 'string'
    ) {
      amountValue = messageValue.amount[0].amount;
    } else if (typeof (messageValue.amount as InjectiveAmount)?.amount === 'string') {
      amountValue = (messageValue.amount as InjectiveAmount).amount;
    }
  }

  const amount = parseDecimal(amountValue).div(Math.pow(10, decimals)).toFixed();

  return {
    bridgeType: 'peggy',
    from,
    to,
    amount,
    currency: 'INJ',
    tokenType: 'native',
    tokenSymbol: 'INJ',
    eventNonce: messageValue.event_nonce,
    ethereumSender: messageValue.ethereum_sender,
    ethereumReceiver: messageValue.ethereum_receiver,
    tokenAddress: messageValue.token_contract,
  };
}

/**
 * Check if a message type should be skipped (not an asset transfer)
 *
 * Skips:
 * - Injective DEX operations (/injective.exchange.*)
 * - Injective oracle operations (/injective.oracle.*)
 * - Cosmos governance operations (MsgVote, MsgVoteWeighted)
 * - Cosmos authz operations (MsgGrant, MsgRevoke)
 * - Cosmos slashing operations (MsgUnjail)
 *
 * @param messageType - Message type to check
 * @returns Skip reason if message should be skipped, undefined otherwise
 */
export function shouldSkipMessage(messageType: string): string | undefined {
  if (messageType.startsWith('/injective.exchange.')) {
    return `Injective DEX operation ${messageType} - not an asset transfer`;
  }

  if (messageType.startsWith('/injective.oracle.')) {
    return `Injective oracle operation ${messageType} - not an asset transfer`;
  }

  const nonTransferTypes = [
    '/cosmos.gov.v1beta1.MsgVote',
    '/cosmos.gov.v1beta1.MsgVoteWeighted',
    '/cosmos.authz.v1beta1.MsgGrant',
    '/cosmos.authz.v1beta1.MsgRevoke',
    '/cosmos.slashing.v1beta1.MsgUnjail',
  ];

  if (nonTransferTypes.includes(messageType)) {
    return `Governance/authz operation ${messageType} - not an asset transfer`;
  }

  return undefined;
}
