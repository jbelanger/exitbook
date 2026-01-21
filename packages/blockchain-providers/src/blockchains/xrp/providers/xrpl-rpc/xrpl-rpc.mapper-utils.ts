import { isErrorWithMessage } from '@exitbook/core';
import { type Result, err } from 'neverthrow';

import { generateUniqueTransactionEventId, type NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import type { XrpBalanceChange, XrpTransaction } from '../../schemas.js';
import { XrpTransactionSchema } from '../../schemas.js';
import { dropsToXrpDecimalString, rippleTimeToUnix } from '../../utils.js';

import type { XrplTransactionWithMeta } from './xrpl-rpc.schemas.js';

/**
 * Pure function for XRPL transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Map XRPL transaction to normalized XrpTransaction
 * Input is already validated by HTTP client, output validated here
 */
export function mapXrplTransaction(
  rawData: XrplTransactionWithMeta,
  address: string
): Result<XrpTransaction, NormalizationError> {
  try {
    const tx = rawData.tx;
    const meta = rawData.meta;

    // Transaction ID (hash)
    const txHash = tx.hash;
    if (!txHash) {
      return err({ message: 'Transaction hash is required for normalization', type: 'error' });
    }

    // Timestamp (convert from Ripple epoch to Unix timestamp in milliseconds)
    if (!tx.date) {
      return err({ message: 'Transaction date is required for normalization', type: 'error' });
    }
    const timestamp = rippleTimeToUnix(tx.date) * 1000;

    // Ledger index (block height)
    const ledgerIndex = tx.ledger_index || tx.inLedger || 0;

    // Fee (in drops, convert to XRP)
    const feeAmount = dropsToXrpDecimalString(tx.Fee);

    // Transaction status from metadata
    const status = meta.TransactionResult === 'tesSUCCESS' ? 'success' : 'failed';

    // Extract balance changes from metadata
    const balanceChanges = extractBalanceChanges(meta, address);

    // Determine currency and amount for eventId generation
    let currency = 'XRP';
    let amount = '0';
    if (tx.Amount) {
      if (typeof tx.Amount === 'string') {
        // XRP amount in drops
        currency = 'XRP';
        amount = dropsToXrpDecimalString(tx.Amount);
      } else if (typeof tx.Amount === 'object' && 'currency' in tx.Amount) {
        // Issued currency
        currency = tx.Amount.currency;
        amount = tx.Amount.value;
      }
    }

    const xrpTransaction: XrpTransaction = {
      account: tx.Account,
      balanceChanges,
      currency,
      destination: tx.Destination,
      destinationTag: tx.DestinationTag,
      eventId: generateUniqueTransactionEventId({
        id: txHash,
        timestamp,
        from: tx.Account,
        to: tx.Destination,
        type: tx.TransactionType.toLowerCase(),
        amount,
        currency,
      }),
      feeAmount,
      feeCurrency: 'XRP',
      id: txHash,
      ledgerIndex,
      providerName: 'xrpl-rpc',
      sequence: tx.Sequence,
      sourceTag: tx.SourceTag,
      status,
      timestamp,
      transactionType: tx.TransactionType,
    };

    return validateOutput(xrpTransaction, XrpTransactionSchema, 'XrplTransaction');
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
    return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
  }
}

/**
 * Extract balance changes from transaction metadata
 * Looks for AccountRoot modifications and creations with balance changes
 */
function extractBalanceChanges(meta: XrplTransactionWithMeta['meta'], accountFilter?: string): XrpBalanceChange[] {
  const changes: XrpBalanceChange[] = [];

  for (const node of meta.AffectedNodes) {
    // Process modified nodes with balance changes
    if ('ModifiedNode' in node && typeof node.ModifiedNode === 'object' && node.ModifiedNode) {
      const modifiedNode = node.ModifiedNode as {
        FinalFields?: { Account?: unknown; Balance?: unknown };
        LedgerEntryType: string;
        PreviousFields?: { Balance?: unknown };
      };

      // Only process AccountRoot entries (native XRP balance changes)
      if (modifiedNode.LedgerEntryType !== 'AccountRoot') continue;

      const finalFields = modifiedNode.FinalFields;
      const previousFields = modifiedNode.PreviousFields;

      // Extract account address
      const account = finalFields?.Account;
      if (!account || typeof account !== 'string') continue;

      // Filter by account if specified
      if (accountFilter && account !== accountFilter) continue;

      // Extract balance changes
      const finalBalance = finalFields?.Balance;
      const previousBalance = previousFields?.Balance;

      if (typeof finalBalance === 'string' && finalBalance) {
        changes.push({
          account,
          balance: dropsToXrpDecimalString(finalBalance),
          currency: 'XRP',
          previousBalance: typeof previousBalance === 'string' ? dropsToXrpDecimalString(previousBalance) : undefined,
        });
      }
    }

    // Process created nodes (new accounts)
    if ('CreatedNode' in node && typeof node.CreatedNode === 'object' && node.CreatedNode) {
      const createdNode = node.CreatedNode as {
        LedgerEntryType: string;
        NewFields?: { Account?: unknown; Balance?: unknown };
      };

      // Only process AccountRoot entries (native XRP balance changes)
      if (createdNode.LedgerEntryType !== 'AccountRoot') continue;

      const newFields = createdNode.NewFields;

      // Extract account address
      const account = newFields?.Account;
      if (!account || typeof account !== 'string') continue;

      // Filter by account if specified
      if (accountFilter && account !== accountFilter) continue;

      // Extract initial balance (no previous balance for new accounts)
      const initialBalance = newFields?.Balance;

      if (typeof initialBalance === 'string' && initialBalance) {
        changes.push({
          account,
          balance: dropsToXrpDecimalString(initialBalance),
          currency: 'XRP',
          previousBalance: undefined,
        });
      }
    }
  }

  return changes;
}
