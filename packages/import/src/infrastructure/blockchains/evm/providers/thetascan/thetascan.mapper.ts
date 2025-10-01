import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.ts';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { parseDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { RegisterTransactionMapper } from '../../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../../shared/base-raw-data-mapper.ts';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { ThetaScanTransactionSchema } from './thetascan.schemas.js';
import type { ThetaScanTransaction } from './thetascan.types.js';

@RegisterTransactionMapper('thetascan')
export class ThetaScanTransactionMapper extends BaseRawDataMapper<ThetaScanTransaction, EvmTransaction> {
  protected readonly inputSchema = ThetaScanTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: ThetaScanTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, string> {
    // Remove commas from amounts (ThetaScan uses "1,000,000.000000" format)
    const thetaAmount = parseDecimal(rawData.theta.replace(/,/g, ''));
    const tfuelAmount = parseDecimal(rawData.tfuel.replace(/,/g, ''));

    // Determine which currency was transferred and the amount
    let currency: string;
    let amount: Decimal;

    // ThetaScan transactions can have both THETA and TFUEL
    // We'll prioritize THETA if non-zero, otherwise TFUEL
    if (thetaAmount.gt(0)) {
      currency = 'THETA';
      amount = thetaAmount;
    } else if (tfuelAmount.gt(0)) {
      currency = 'TFUEL';
      amount = tfuelAmount;
    } else {
      // Zero-value transaction, default to TFUEL
      currency = 'TFUEL';
      amount = new Decimal(0);
    }

    // Convert amount to wei (18 decimals for Theta network)
    const THETA_DECIMALS = 18;
    const amountInWei = amount.mul(new Decimal(10).pow(THETA_DECIMALS));

    // Convert timestamp (Unix timestamp in seconds) to milliseconds
    const timestamp = rawData.timestamp * 1000;

    // Calculate fee in wei
    const feeInWei = new Decimal(rawData.fee_tfuel).mul(new Decimal(10).pow(THETA_DECIMALS));

    const transaction: EvmTransaction = {
      amount: amountInWei.toFixed(0),
      blockHeight: parseInt(rawData.block),
      currency,
      feeAmount: feeInWei.toFixed(0),
      feeCurrency: 'TFUEL', // Fees are always paid in TFUEL on Theta
      from: rawData.sending_address,
      id: rawData.hash,
      providerId: 'thetascan',
      status: 'success', // ThetaScan only returns successful transactions
      timestamp,
      to: rawData.recieving_address,
      tokenType: 'native',
      type: 'transfer',
    };

    return ok(transaction);
  }
}
