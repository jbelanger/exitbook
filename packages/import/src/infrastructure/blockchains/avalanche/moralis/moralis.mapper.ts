import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.ts';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { parseDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { MoralisTransactionSchema } from '../../shared/api/moralis-evm/moralis.schemas.js';
import type { MoralisTransaction } from '../../shared/api/moralis-evm/moralis.types.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import { AvalancheTransactionSchema } from '../schemas.js';
import type { AvalancheTransaction } from '../types.js';

@RegisterTransactionMapper('moralis')
export class MoralisTransactionMapper extends BaseRawDataMapper<MoralisTransaction, AvalancheTransaction> {
  protected readonly inputSchema = MoralisTransactionSchema;
  protected readonly outputSchema = AvalancheTransactionSchema;

  protected mapInternal(
    rawData: MoralisTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<AvalancheTransaction, string> {
    const valueWei = parseDecimal(rawData.value);
    const valueAvax = valueWei.dividedBy(new Decimal(10).pow(18));
    const timestamp = new Date(rawData.block_timestamp).getTime();

    // Calculate gas fee
    const gasUsed = parseDecimal(rawData.receipt_gas_used || '0');
    const gasPrice = parseDecimal(rawData.gas_price || '0');
    const feeWei = gasUsed.mul(gasPrice);
    const feeAvax = feeWei.dividedBy(new Decimal(10).pow(18));

    const transaction: AvalancheTransaction = {
      amount: valueAvax.toString(),
      blockHeight: parseInt(rawData.block_number),
      blockId: rawData.block_hash,
      currency: 'AVAX',
      feeAmount: feeAvax.toString(),
      feeCurrency: 'AVAX',
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
