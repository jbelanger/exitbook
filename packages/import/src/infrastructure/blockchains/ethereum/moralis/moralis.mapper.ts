import { parseDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import type { RawTransactionMetadata } from '../../../../app/ports/importers.ts';
import type { ImportSessionMetadata } from '../../../../app/ports/transaction-processor.interface.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { EthereumTransaction } from '../types.js';

import { MoralisTransactionSchema } from './moralis.schemas.js';
import type { MoralisTransaction } from './moralis.types.js';

@RegisterTransactionMapper('moralis')
export class MoralisTransactionMapper extends BaseRawDataMapper<MoralisTransaction, EthereumTransaction> {
  protected readonly schema = MoralisTransactionSchema;

  protected mapInternal(
    rawData: MoralisTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<EthereumTransaction, string> {
    const valueWei = parseDecimal(rawData.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));
    const timestamp = new Date(rawData.block_timestamp).getTime();

    // Calculate gas fee
    const gasUsed = parseDecimal(rawData.receipt_gas_used || '0');
    const gasPrice = parseDecimal(rawData.gas_price || '0');
    const feeWei = gasUsed.mul(gasPrice);
    const feeEth = feeWei.dividedBy(new Decimal(10).pow(18));

    const transaction: EthereumTransaction = {
      amount: valueEth.toString(),
      blockHeight: parseInt(rawData.block_number),
      blockId: rawData.block_hash,
      currency: 'ETH',
      feeAmount: feeEth.toString(),
      feeCurrency: 'ETH',
      from: rawData.from_address,
      gasPrice: rawData.gas_price,
      gasUsed: rawData.receipt_gas_used,
      id: rawData.hash,
      inputData: rawData.input,
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
