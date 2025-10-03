import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../core/blockchain/base-raw-data-mapper.ts';
import { RegisterTransactionMapper } from '../../../../core/blockchain/index.ts';
import type { NormalizationError } from '../../../../ports/blockchain-normalizer.interface.ts';
import { EvmTransactionSchema } from '../../schemas.ts';
import type { EvmTransaction } from '../../types.ts';

import { MoralisTransactionSchema } from './moralis.schemas.ts';
import type { MoralisTransaction } from './moralis.types.ts';

@RegisterTransactionMapper('moralis')
export class MoralisTransactionMapper extends BaseRawDataMapper<MoralisTransaction, EvmTransaction> {
  protected readonly inputSchema = MoralisTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: MoralisTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, NormalizationError> {
    // Get chain-specific info from augmented fields
    const nativeCurrency = rawData._nativeCurrency || 'UNKNOWN';
    const nativeDecimals = rawData._nativeDecimals || 18;

    // Parse value - Zod already validated it's numeric
    const valueWei = new Decimal(rawData.value);

    // Convert to native currency units
    const valueNative = valueWei.dividedBy(new Decimal(10).pow(nativeDecimals));
    const timestamp = new Date(rawData.block_timestamp).getTime();

    // Calculate gas fee - Zod already validated they're numeric
    const gasUsed = new Decimal(rawData.receipt_gas_used || '0');
    const gasPrice = new Decimal(rawData.gas_price || '0');

    const feeWei = gasUsed.mul(gasPrice);
    const feeNative = feeWei.dividedBy(new Decimal(10).pow(nativeDecimals));

    const transaction: EvmTransaction = {
      amount: valueNative.toString(),
      blockHeight: parseInt(rawData.block_number),
      blockId: rawData.block_hash,
      currency: nativeCurrency,
      feeAmount: feeNative.toString(),
      feeCurrency: nativeCurrency,
      from: rawData.from_address,
      gasPrice: rawData.gas_price && rawData.gas_price !== '' ? rawData.gas_price : undefined,
      gasUsed: rawData.receipt_gas_used && rawData.receipt_gas_used !== '' ? rawData.receipt_gas_used : undefined,
      id: rawData.hash,
      inputData: rawData.input && rawData.input !== '' ? rawData.input : undefined,
      methodId: rawData.input && rawData.input.length >= 10 ? rawData.input.slice(0, 10) : undefined,
      providerId: 'moralis',
      status: rawData.receipt_status === '1' ? 'success' : 'failed',
      timestamp,
      to: rawData.to_address,
      tokenType: 'native',
      type: 'transfer',
    };

    return ok(transaction);
  }
}
