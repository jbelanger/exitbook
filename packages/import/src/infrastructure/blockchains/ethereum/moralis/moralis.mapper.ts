import { parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';

import { MoralisTransactionSchema } from './moralis.schemas.ts';
import type { MoralisTransaction } from './moralis.types.ts';

@RegisterTransactionMapper('moralis')
export class MoralisTransactionMapper extends BaseRawDataMapper<MoralisTransaction, UniversalBlockchainTransaction> {
  protected readonly schema = MoralisTransactionSchema;

  protected mapInternal(
    rawData: MoralisTransaction,
    _sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    // Determine transaction type - ETH native transfers are just transfers
    const type: UniversalBlockchainTransaction['type'] = 'transfer';

    const valueWei = parseDecimal(rawData.value);
    const valueEth = valueWei.dividedBy(new Decimal(10).pow(18));
    const timestamp = new Date(rawData.block_timestamp).getTime();

    const transaction: UniversalBlockchainTransaction = {
      amount: valueEth.toString(),
      blockHeight: parseInt(rawData.block_number),
      currency: 'ETH',
      from: rawData.from_address,
      id: rawData.hash,
      providerId: 'moralis',
      status: rawData.receipt_status === '1' ? 'success' : 'failed',
      timestamp,
      to: rawData.to_address,
      type,
    };

    return ok(transaction);
  }
}
