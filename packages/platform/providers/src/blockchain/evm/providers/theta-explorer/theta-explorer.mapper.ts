import { parseDecimal } from '@exitbook/core';
import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { type Result, ok, err } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../core/blockchain/base/mapper.ts';
import { RegisterTransactionMapper } from '../../../../core/blockchain/index.ts';
import type { NormalizationError } from '../../../../core/blockchain/index.ts';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { ThetaTransactionSchema } from './theta-explorer.schemas.js';
import type { ThetaTransaction, ThetaSendTransactionData, ThetaSmartContractData } from './theta-explorer.types.js';

@RegisterTransactionMapper('theta-explorer')
export class ThetaExplorerTransactionMapper extends BaseRawDataMapper<ThetaTransaction, EvmTransaction> {
  protected readonly inputSchema = ThetaTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: ThetaTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, NormalizationError> {
    // Extract transaction details based on type
    let from: string;
    let to: string;
    let amount: Decimal;
    let currency: string;

    // Type 2: Send transaction
    if (rawData.type === 2) {
      const data = rawData.data as ThetaSendTransactionData;

      // Get from/to addresses
      from = data.source?.address || data.inputs?.[0]?.address || '0x0';
      to = data.target?.address || data.outputs?.[0]?.address || '0x0';

      // Determine currency and amount
      // The API can use either source/target OR inputs/outputs pattern
      // Check both TFUEL and THETA, prioritize THETA over TFUEL (for consistency with ThetaScan)

      // Try target first, then outputs[0]
      const tfuelWei = parseDecimal(data.target?.coins?.tfuelwei || data.outputs?.[0]?.coins?.tfuelwei || '0');
      const thetaWei = parseDecimal(data.target?.coins?.thetawei || data.outputs?.[0]?.coins?.thetawei || '0');

      if (thetaWei.gt(0)) {
        currency = 'THETA';
        amount = thetaWei;
      } else if (tfuelWei.gt(0)) {
        currency = 'TFUEL';
        amount = tfuelWei;
      } else {
        // If both are zero, check source/inputs for outgoing amounts
        const sourceTfuel = parseDecimal(data.source?.coins?.tfuelwei || data.inputs?.[0]?.coins?.tfuelwei || '0');
        const sourceTheta = parseDecimal(data.source?.coins?.thetawei || data.inputs?.[0]?.coins?.thetawei || '0');

        if (sourceTheta.gt(0)) {
          currency = 'THETA';
          amount = sourceTheta;
        } else if (sourceTfuel.gt(0)) {
          currency = 'TFUEL';
          amount = sourceTfuel;
        } else {
          currency = 'TFUEL';
          amount = new Decimal(0);
        }
      }
    }
    // Type 7: Smart contract transaction
    else if (rawData.type === 7) {
      const data = rawData.data as ThetaSmartContractData;

      from = data.from?.address || '0x0';
      to = data.to?.address || '0x0';

      // For smart contract transactions, check both coins, prioritize THETA over TFUEL
      const tfuelWei = parseDecimal(data.to?.coins?.tfuelwei || '0');
      const thetaWei = parseDecimal(data.to?.coins?.thetawei || '0');

      if (thetaWei.gt(0)) {
        currency = 'THETA';
        amount = thetaWei;
      } else if (tfuelWei.gt(0)) {
        currency = 'TFUEL';
        amount = tfuelWei;
      } else {
        currency = 'TFUEL';
        amount = new Decimal(0);
      }
    }
    // Other transaction types - skip for now
    else {
      return err({ message: `Unsupported transaction type: ${rawData.type}`, type: 'error' });
    }

    // Convert timestamp (already in unix seconds)
    const timestamp = parseInt(rawData.timestamp) * 1000; // Convert to milliseconds

    // Convert block height to number
    const blockHeight = parseInt(rawData.block_height);

    // Theta blockchain has TWO native currencies: THETA and TFUEL
    // The processor expects nativeCurrency to be TFUEL (for fees), so we map THETA
    // transfers as token_transfer to preserve the correct symbol
    const isThetaTransfer = currency === 'THETA';
    const THETA_DECIMALS = 18;

    // Amount handling:
    // - Amounts from API are already in wei (thetawei/tfuelwei)
    // - THETA transfers are mapped as token_transfer, so amounts should be normalized (not wei)
    // - TFUEL transfers are mapped as native transfer, so amounts should stay in wei
    const amountFormatted = isThetaTransfer
      ? amount.dividedBy(new Decimal(10).pow(THETA_DECIMALS)).toString()
      : amount.toFixed(0); // Use toFixed(0) to avoid scientific notation

    const transaction: EvmTransaction = {
      amount: amountFormatted,
      blockHeight,
      currency,
      from,
      id: rawData.hash,
      providerId: 'theta-explorer',
      status: 'success',
      timestamp,
      to,
      tokenSymbol: isThetaTransfer ? 'THETA' : 'TFUEL',
      tokenType: 'native',
      type: isThetaTransfer ? 'token_transfer' : 'transfer',
    };

    return ok(transaction);
  }
}
