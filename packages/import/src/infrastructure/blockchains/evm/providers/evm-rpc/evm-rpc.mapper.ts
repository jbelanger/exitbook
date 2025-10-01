import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.ts';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { RegisterTransactionMapper } from '../../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../../shared/base-raw-data-mapper.ts';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { EvmRpcRawDataSchema } from './evm-rpc.schemas.js';
import type { EvmRpcRawData, EvmRpcLog } from './evm-rpc.types.js';
import { ERC20_TRANSFER_EVENT_SIGNATURE, ERC721_TRANSFER_EVENT_SIGNATURE } from './evm-rpc.types.js';

@RegisterTransactionMapper('evm-rpc')
export class EvmRpcTransactionMapper extends BaseRawDataMapper<EvmRpcRawData, EvmTransaction> {
  protected readonly inputSchema = EvmRpcRawDataSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: EvmRpcRawData,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, string> {
    const { transaction, receipt } = rawData;

    // Determine transaction status
    const status = receipt.status === '0x1' ? 'success' : receipt.status === '0x0' ? 'failed' : 'pending';

    // Get timestamp from block if available, otherwise use current time
    const timestamp = rawData.block?.timestamp ? parseInt(rawData.block.timestamp, 16) * 1000 : Date.now();

    // Parse amounts from hex strings
    const value = new Decimal(BigInt(transaction.value || '0x0').toString());
    const gasUsed = new Decimal(BigInt(receipt.gasUsed || '0x0').toString());
    const effectiveGasPrice = new Decimal(BigInt(receipt.effectiveGasPrice || '0x0').toString());
    const feeAmount = gasUsed.mul(effectiveGasPrice);

    // Check if this is a token transfer by looking at logs
    const transferLog = this.findTransferLog(receipt.logs, transaction.from, transaction.to ?? undefined);

    let evmTransaction: EvmTransaction;

    if (transferLog) {
      // This is a token transfer
      const tokenAmount = this.parseTokenAmount(transferLog);
      const tokenAddress = transferLog.address;

      evmTransaction = {
        amount: tokenAmount.toString(),
        blockHeight: transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : undefined,
        currency: 'UNKNOWN', // Will need token metadata to get symbol
        feeAmount: feeAmount.toString(),
        feeCurrency:
          typeof rawData._nativeCurrency === 'string' && rawData._nativeCurrency.length > 0
            ? rawData._nativeCurrency
            : 'ETH',
        from: transaction.from,
        gasPrice: transaction.gasPrice,
        gasUsed: receipt.gasUsed,
        id: transaction.hash,
        inputData: transaction.input,
        methodId: transaction.input && transaction.input.length >= 10 ? transaction.input.slice(0, 10) : undefined,
        providerId: 'evm-rpc',
        status,
        timestamp,
        to: transaction.to || '0x0000000000000000000000000000000000000000',
        tokenAddress,
        tokenType: this.determineTokenType(transferLog),
        type: 'token_transfer',
      };
    } else if (transaction.input && transaction.input !== '0x' && transaction.to) {
      // This is a contract call
      evmTransaction = {
        amount: value.toString(),
        blockHeight: transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : undefined,
        currency:
          typeof rawData._nativeCurrency === 'string' && rawData._nativeCurrency && rawData._nativeCurrency.length > 0
            ? rawData._nativeCurrency
            : 'ETH',
        feeAmount: feeAmount.toString(),
        feeCurrency:
          typeof rawData._nativeCurrency === 'string' && rawData._nativeCurrency.length > 0
            ? rawData._nativeCurrency
            : 'ETH',
        from: transaction.from,
        gasPrice: transaction.gasPrice,
        gasUsed: receipt.gasUsed,
        id: transaction.hash,
        inputData: transaction.input,
        methodId: transaction.input.slice(0, 10),
        providerId: 'evm-rpc',
        status,
        timestamp,
        to: transaction.to,
        tokenType: 'native',
        type: 'contract_call',
      };
    } else {
      // This is a simple transfer
      evmTransaction = {
        amount: value.toString(),
        blockHeight: transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : undefined,
        currency:
          typeof rawData._nativeCurrency === 'string' && rawData._nativeCurrency.length > 0
            ? rawData._nativeCurrency
            : 'ETH',
        feeAmount: feeAmount.toString(),
        feeCurrency:
          typeof rawData._nativeCurrency === 'string' && rawData._nativeCurrency.length > 0
            ? rawData._nativeCurrency
            : 'ETH',
        from: transaction.from,
        gasPrice: transaction.gasPrice,
        gasUsed: receipt.gasUsed,
        id: transaction.hash,
        providerId: 'evm-rpc',
        status,
        timestamp,
        to: transaction.to || '0x0000000000000000000000000000000000000000',
        tokenType: 'native',
        type: 'transfer',
      };
    }

    return ok(evmTransaction);
  }

  /**
   * Find a Transfer event log in the transaction logs
   */
  private findTransferLog(logs: EvmRpcLog[], _from: string, _to: string | undefined): EvmRpcLog | undefined {
    for (const log of logs) {
      // Check if this is a Transfer event
      if (log.topics[0] === ERC20_TRANSFER_EVENT_SIGNATURE || log.topics[0] === ERC721_TRANSFER_EVENT_SIGNATURE) {
        return log;
      }
    }
    return undefined;
  }

  /**
   * Parse token amount from Transfer event log
   */
  private parseTokenAmount(log: EvmRpcLog): Decimal {
    // For ERC-20/721, amount is in the data field (non-indexed parameter)
    // Data is a hex string representing the amount
    if (log.data && log.data !== '0x') {
      try {
        return new Decimal(BigInt(log.data).toString());
      } catch {
        return new Decimal(0);
      }
    }
    return new Decimal(0);
  }

  /**
   * Determine token type from event signature
   */
  private determineTokenType(log: EvmRpcLog): EvmTransaction['tokenType'] {
    if (log.topics[0] === ERC20_TRANSFER_EVENT_SIGNATURE) {
      // Could be ERC-20 or ERC-721, default to ERC-20
      // Would need more sophisticated detection (e.g., checking if data is empty for NFTs)
      return log.data === '0x' ? 'erc721' : 'erc20';
    }
    return 'erc20';
  }
}
