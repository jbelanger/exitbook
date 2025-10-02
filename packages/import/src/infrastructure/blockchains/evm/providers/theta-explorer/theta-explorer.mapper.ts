import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.ts';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { parseDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok, err } from 'neverthrow';

import { RegisterTransactionMapper } from '../../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../../shared/base-raw-data-mapper.ts';
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
  ): Result<EvmTransaction, string> {
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
      // Check both TFUEL and THETA, prioritize the one with non-zero value
      const tfuelWei = parseDecimal(data.target?.coins?.tfuelwei || '0');
      const thetaWei = parseDecimal(data.target?.coins?.thetawei || '0');

      if (tfuelWei.gt(0)) {
        currency = 'TFUEL';
        amount = tfuelWei;
      } else if (thetaWei.gt(0)) {
        currency = 'THETA';
        amount = thetaWei;
      } else {
        // If both are zero, check source for outgoing amounts
        const sourceTfuel = parseDecimal(data.source?.coins?.tfuelwei || '0');
        const sourceTheta = parseDecimal(data.source?.coins?.thetawei || '0');

        if (sourceTfuel.gt(0)) {
          currency = 'TFUEL';
          amount = sourceTfuel;
        } else if (sourceTheta.gt(0)) {
          currency = 'THETA';
          amount = sourceTheta;
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

      // For smart contract transactions, check both coins
      const tfuelWei = parseDecimal(data.to?.coins?.tfuelwei || '0');
      const thetaWei = parseDecimal(data.to?.coins?.thetawei || '0');

      if (tfuelWei.gt(0)) {
        currency = 'TFUEL';
        amount = tfuelWei;
      } else if (thetaWei.gt(0)) {
        currency = 'THETA';
        amount = thetaWei;
      } else {
        currency = 'TFUEL';
        amount = new Decimal(0);
      }
    }
    // Other transaction types - skip for now
    else {
      return err(`Unsupported transaction type: ${rawData.type}`);
    }

    // Convert timestamp (already in unix seconds)
    const timestamp = parseInt(rawData.timestamp) * 1000; // Convert to milliseconds

    // Convert block height to number
    const blockHeight = parseInt(rawData.block_height);

    const transaction: EvmTransaction = {
      amount: amount.toString(),
      blockHeight,
      currency,
      from,
      id: rawData.hash,
      providerId: 'theta-explorer',
      status: 'success',
      timestamp,
      to,
      tokenType: 'native',
      type: 'transfer',
    };

    return ok(transaction);
  }
}
