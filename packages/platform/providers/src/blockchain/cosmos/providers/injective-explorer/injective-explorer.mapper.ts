import { parseDecimal } from '@exitbook/core';
import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../core/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../core/blockchain/index.ts';
import { RegisterTransactionMapper } from '../../../../core/blockchain/index.ts';
import { CosmosTransactionSchema } from '../../schemas.ts';
import type { CosmosTransaction } from '../../types.js';

import { InjectiveTransactionSchema as InjectiveExplorerTransactionSchema } from './injective-explorer.schemas.js';
import type {
  InjectiveExplorerTransaction as InjectiveApiTransaction,
  InjectiveExplorerMessageValue,
  InjectiveExplorerAmount,
} from './injective-explorer.types.ts';

@RegisterTransactionMapper('injective-explorer')
export class InjectiveExplorerTransactionMapper extends BaseRawDataMapper<InjectiveApiTransaction, CosmosTransaction> {
  protected readonly inputSchema = InjectiveExplorerTransactionSchema;
  protected readonly outputSchema = CosmosTransactionSchema;
  private readonly logger = getLogger('InjectiveExplorerMapper');

  protected mapInternal(
    rawData: InjectiveApiTransaction,
    _metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<CosmosTransaction, NormalizationError> {
    const timestamp = rawData.block_timestamp.getTime();

    if (!sessionContext.address) {
      return err({ message: 'Invalid address', type: 'error' });
    }

    // Extract address from rich session context
    const relevantAddress = sessionContext.address;

    let amount = '0';
    let feeAmount = '0';
    let from = '';
    let to = '';
    let currency = 'INJ';
    let feeCurrency = 'INJ';

    // Cosmos-specific fields
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

    // Parse fee from gas_fee field
    if (
      rawData.gas_fee &&
      rawData.gas_fee.amount &&
      Array.isArray(rawData.gas_fee.amount) &&
      rawData.gas_fee.amount.length > 0
    ) {
      const firstFee = rawData.gas_fee.amount[0];
      if (firstFee && firstFee.amount && firstFee.denom) {
        feeAmount = parseDecimal(firstFee.amount).div(Math.pow(10, 18)).toString();
        feeCurrency = this.formatDenom(firstFee.denom);
      }
    }

    // Parse messages to extract transfer information and determine relevance
    let isRelevantTransaction = false;

    for (const message of rawData.messages) {
      messageType = message.type;

      // Skip Injective-specific non-asset operations
      if (message.type.startsWith('/injective.exchange.')) {
        this.logger.debug(`Skipping Injective DEX operation: ${message.type} in tx ${rawData.hash}`);
        return err({
          reason: `Injective DEX operation ${message.type} - not an asset transfer`,
          type: 'skip',
        });
      }
      if (message.type.startsWith('/injective.oracle.')) {
        this.logger.debug(`Skipping Injective oracle operation: ${message.type} in tx ${rawData.hash}`);
        return err({
          reason: `Injective oracle operation ${message.type} - not an asset transfer`,
          type: 'skip',
        });
      }

      // Skip Cosmos governance and authz non-transfer operations
      if (
        message.type === '/cosmos.gov.v1beta1.MsgVote' ||
        message.type === '/cosmos.gov.v1beta1.MsgVoteWeighted' ||
        message.type === '/cosmos.authz.v1beta1.MsgGrant' ||
        message.type === '/cosmos.authz.v1beta1.MsgRevoke' ||
        message.type === '/cosmos.slashing.v1beta1.MsgUnjail'
      ) {
        this.logger.debug(`Skipping governance/authz operation: ${message.type} in tx ${rawData.hash}`);
        return err({
          reason: `Governance/authz operation ${message.type} - not an asset transfer`,
          type: 'skip',
        });
      }

      // Handle bank transfer messages
      if (message.type === '/cosmos.bank.v1beta1.MsgSend') {
        from = message.value.from_address || '';
        to = message.value.to_address || '';
        bridgeType = 'native';

        if (message.value.amount && Array.isArray(message.value.amount) && message.value.amount.length > 0) {
          const transferAmount = message.value.amount[0];
          if (transferAmount) {
            amount = parseDecimal(transferAmount.amount).div(Math.pow(10, 18)).toString();
            currency = this.formatDenom(transferAmount.denom);
            tokenType = 'native';
            tokenSymbol = currency;
          }
        }

        // Determine if this transaction is relevant to our wallet
        if (to && relevantAddress === to && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
        } else if (from && relevantAddress === from && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
        }
        break; // Use first transfer message
      }

      // Handle IBC transfer messages
      else if (message.type === '/ibc.applications.transfer.v1.MsgTransfer') {
        from = message.value.sender || '';
        to = message.value.receiver || '';
        bridgeType = 'ibc';

        sourceChannel = message.value.source_channel;
        sourcePort = message.value.source_port;

        if (message.value.token) {
          amount = parseDecimal(message.value.token.amount).div(Math.pow(10, 18)).toString();
          currency = this.formatDenom(message.value.token.denom);
          tokenType = 'ibc';
          tokenSymbol = currency;
        }

        // Determine if this transaction is relevant to our wallet
        if (to && relevantAddress === to && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
        } else if (from && relevantAddress === from && parseDecimal(amount).toNumber() > 0) {
          isRelevantTransaction = true;
        }
        break;
      }

      // Handle CosmWasm contract execution (standard)
      else if (message.type === '/cosmwasm.wasm.v1.MsgExecuteContract') {
        from = message.value.sender || '';
        to = message.value.contract || '';

        // Check if this is relevant to our wallet (user is the sender)
        if (from && relevantAddress === from) {
          isRelevantTransaction = true;

          // Extract funds sent with the contract call (not internal transfers)
          if (message.value.funds && Array.isArray(message.value.funds) && message.value.funds.length > 0) {
            const fund = message.value.funds[0];
            if (fund && fund.amount && fund.denom) {
              amount = parseDecimal(fund.amount).div(Math.pow(10, 18)).toString();
              currency = this.formatDenom(fund.denom);
              tokenType = 'native';
              tokenSymbol = currency;
            }
          }
        }
        break;
      }

      // Handle Injective-specific contract execution (wasmx)
      else if (message.type === '/injective.wasmx.v1.MsgExecuteContractCompat') {
        from = message.value.sender || '';
        to = message.value.contract || '';

        // Check if this is relevant to our wallet (user is the sender)
        if (from && relevantAddress === from) {
          isRelevantTransaction = true;

          // Extract funds sent with the contract call (string format in wasmx)
          if (message.value.funds && typeof message.value.funds === 'string') {
            const fundsValue = parseDecimal(message.value.funds);
            if (fundsValue.toNumber() > 0) {
              amount = fundsValue.div(Math.pow(10, 18)).toString();
              currency = 'INJ'; // Default to INJ for wasmx
              tokenType = 'native';
              tokenSymbol = currency;
            }
          }
        }
        break;
      }

      // Handle Peggy bridge withdrawal messages (sending funds to Ethereum)
      else if (message.type === '/injective.peggy.v1.MsgSendToEth') {
        const messageValue = message.value as InjectiveExplorerMessageValue & {
          amount?: InjectiveExplorerAmount | undefined;
          bridge_fee?: InjectiveExplorerAmount | undefined;
          eth_dest?: string | undefined;
        };

        bridgeType = 'peggy';
        from = messageValue.sender || '';
        to = messageValue.eth_dest || '';
        ethereumReceiver = messageValue.eth_dest;

        // Check if this is relevant to our wallet (user is the sender)
        if (from && relevantAddress === from) {
          isRelevantTransaction = true;

          // Extract amount from the withdrawal
          if (messageValue.amount && messageValue.amount.amount && messageValue.amount.denom) {
            amount = parseDecimal(messageValue.amount.amount).div(Math.pow(10, 18)).toString();
            currency = this.formatDenom(messageValue.amount.denom);
            tokenType = 'native';
            tokenSymbol = currency;
          }
        }
        break;
      }

      // Handle Peggy bridge deposit messages (when funds come from Ethereum)
      else if (message.type === '/injective.peggy.v1.MsgDepositClaim') {
        const messageValue = message.value as InjectiveExplorerMessageValue & {
          cosmos_receiver?: string | undefined;
          ethereum_receiver?: string | undefined;
          ethereum_sender?: string | undefined;
          event_nonce?: string | undefined;
        };

        bridgeType = 'peggy';
        eventNonce = messageValue.event_nonce;
        ethereumSender = messageValue.ethereum_sender;
        ethereumReceiver = messageValue.ethereum_receiver;

        if (
          (messageValue.ethereum_receiver && relevantAddress === messageValue.ethereum_receiver) ||
          (messageValue.cosmos_receiver && relevantAddress === messageValue.cosmos_receiver)
        ) {
          isRelevantTransaction = true;
          to = messageValue.cosmos_receiver || messageValue.ethereum_receiver || '';
          from = messageValue.ethereum_sender || '';

          // Extract amount from the deposit claim if available
          if (messageValue.amount && messageValue.token_contract) {
            let amountValue = '0';
            if (typeof messageValue.amount === 'string') {
              amountValue = messageValue.amount;
            } else if (
              Array.isArray(messageValue.amount) &&
              messageValue.amount.length > 0 &&
              typeof messageValue.amount[0]?.amount === 'string'
            ) {
              amountValue = messageValue.amount[0].amount;
            } else if (typeof (messageValue.amount as InjectiveExplorerAmount)?.amount === 'string') {
              amountValue = (messageValue.amount as InjectiveExplorerAmount).amount;
            }
            amount = parseDecimal(amountValue).div(Math.pow(10, 18)).toString();
            currency = 'INJ';
            tokenAddress = messageValue.token_contract;
            tokenType = 'native';
            tokenSymbol = currency;
          }
        }
      }

      // Unhandled message type - log and skip
      else {
        this.logger.debug(`Skipping unsupported message type "${message.type}" in transaction ${rawData.hash}.`);
        return err({
          reason: `Unsupported message type ${message.type}`,
          type: 'skip',
        });
      }
    }

    // Only process transactions that are relevant to our wallet
    if (!isRelevantTransaction) {
      return err({
        reason:
          `Transaction not relevant to wallet. ` +
          `MessageType="${messageType}", relevantAddress="${relevantAddress}", from="${from}", to="${to}"`,
        type: 'skip',
      });
    }

    // For Peggy deposits, use event_nonce as the unique identifier to deduplicate validator consensus votes
    // Multiple validators submit the same deposit claim (same event_nonce) as separate blockchain transactions
    // Fall back to claim_id from transaction level if event_nonce is not available
    let peggyId: string | undefined;
    if (eventNonce) {
      peggyId = eventNonce;
    } else if (rawData.claim_id && Array.isArray(rawData.claim_id) && rawData.claim_id.length > 0) {
      peggyId = String(rawData.claim_id[0]);
    }

    const transactionId = peggyId ? `peggy-deposit-${peggyId}` : rawData.hash;

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
      providerId: 'injective-explorer',
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

    return ok(transaction);
  }

  private formatDenom(denom: string | undefined): string {
    if (!denom) {
      return 'INJ';
    }

    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    return denom.toUpperCase();
  }
}
