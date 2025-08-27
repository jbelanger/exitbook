import type { TransactionType, UniversalTransaction } from '@crypto/core';

import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
import { CoinbaseCCXTAdapter } from './ccxt-adapter.ts';
import type { CoinbaseCredentials } from './types.ts';

/**
 * Importer for Coinbase transactions using CCXT adapter.
 * Fetches transactions directly from Coinbase's API using the specialized ledger adapter.
 */
export class CoinbaseImporter extends BaseImporter<UniversalTransaction> {
  constructor() {
    super('coinbase');
  }

  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    const exchangeCredentials = params.exchangeCredentials as { coinbase?: Partial<CoinbaseCredentials> } | undefined;
    if (!exchangeCredentials?.coinbase) {
      this.logger.error('Coinbase credentials are required for import');
      return false;
    }

    const credentials = exchangeCredentials.coinbase;
    if (!credentials.apiKey || !credentials.secret || !credentials.passphrase) {
      this.logger.error('Complete Coinbase credentials (apiKey, secret, passphrase) are required');
      return false;
    }

    // Test connection to Coinbase
    try {
      const coinbaseCredentials: CoinbaseCredentials = {
        apiKey: credentials.apiKey,
        passphrase: credentials.passphrase,
        sandbox: credentials.sandbox || false,
        secret: credentials.secret,
      };

      const adapter = new CoinbaseCCXTAdapter(coinbaseCredentials, { enableOnlineVerification: false });

      // Test the connection by trying to get adapter info
      await adapter.getInfo();
      await adapter.close();

      this.logger.info('Coinbase connection test successful');
      return true;
    } catch (error) {
      this.logger.error(`Failed to connect to Coinbase: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async import(params: ImportParams): Promise<ImportRunResult<UniversalTransaction>> {
    this.logger.info('Starting Coinbase transaction import using CCXT adapter');

    const exchangeCredentials = params.exchangeCredentials as { coinbase?: Partial<CoinbaseCredentials> } | undefined;
    if (!exchangeCredentials?.coinbase) {
      throw new Error('Coinbase credentials are required for import');
    }

    const credentials = exchangeCredentials.coinbase;
    const coinbaseCredentials: CoinbaseCredentials = {
      apiKey: credentials.apiKey!,
      passphrase: credentials.passphrase || '',
      sandbox: credentials.sandbox || false,
      secret: credentials.secret!,
    };

    let adapter: CoinbaseCCXTAdapter | null = null;

    try {
      // Create the CCXT adapter
      adapter = new CoinbaseCCXTAdapter(coinbaseCredentials, { enableOnlineVerification: false });

      // Fetch transactions using the adapter
      const fetchParams = {
        limit: (params.limit as number) || 1000,
        since: params.since,
        symbols: params.symbols as string[] | undefined,
        transactionTypes: (params.transactionTypes as TransactionType[]) || [
          'trade',
          'deposit',
          'withdrawal',
          'ledger',
        ],
      };

      const transactions = await adapter.fetchTransactions(fetchParams);

      this.logger.info(`Successfully imported ${transactions.length} transactions from Coinbase`);

      // Wrap transactions with provider information for the processor
      const rawData = transactions.map(transaction => ({
        providerId: 'coinbase-ccxt',
        rawData: transaction,
      }));

      return {
        rawData,
      };
    } catch (error) {
      this.handleImportError(error, 'Coinbase CCXT adapter');
      return {
        rawData: [],
      };
    } finally {
      if (adapter) {
        await adapter.close();
      }
    }
  }
}
