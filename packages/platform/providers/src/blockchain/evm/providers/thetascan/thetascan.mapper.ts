import { parseDecimal } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../core/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../core/blockchain/index.ts';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { ThetaScanTransactionSchema, type ThetaScanTransaction } from './thetascan.schemas.js';

export class ThetaScanTransactionMapper extends BaseRawDataMapper<ThetaScanTransaction, EvmTransaction> {
  protected readonly inputSchema = ThetaScanTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: ThetaScanTransaction,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, NormalizationError> {
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
      amount = parseDecimal('0');
    }

    // Theta blockchain has TWO native currencies: THETA and TFUEL
    // The processor expects nativeCurrency to be TFUEL (for fees), so we map THETA
    // transfers as token_transfer to preserve the correct symbol
    const isThetaTransfer = currency === 'THETA';

    // Convert timestamp to milliseconds
    const timestamp = rawData.timestamp.getTime();

    // Calculate fee in wei
    const THETA_DECIMALS = 18;
    const feeInWei = parseDecimal(rawData.fee_tfuel.toString()).mul(parseDecimal('10').pow(THETA_DECIMALS));

    // Amount handling:
    // - THETA transfers are mapped as token_transfer, so amounts should be normalized (not wei)
    // - TFUEL transfers are mapped as native transfer, so amounts should be in wei
    const amountFormatted = isThetaTransfer
      ? amount.toString()
      : amount.mul(parseDecimal('10').pow(THETA_DECIMALS)).toFixed(0);

    const transaction: EvmTransaction = {
      amount: amountFormatted,
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
      tokenSymbol: isThetaTransfer ? 'THETA' : 'TFUEL',
      tokenType: 'native',
      type: isThetaTransfer ? 'token_transfer' : 'transfer',
    };

    return ok(transaction);
  }
}
