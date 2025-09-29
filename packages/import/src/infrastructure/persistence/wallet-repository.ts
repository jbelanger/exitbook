import type { KyselyDB } from '@exitbook/data';
import type { NewWalletAddress, WalletAddressUpdate, WalletAddress } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { IWalletRepository } from '@exitbook/import/app/ports/wallet-repository.js';

/**
 * Kysely-based repository for wallet address database operations.
 * Handles storage and retrieval of WalletAddress entities using type-safe queries.
 */
export class WalletRepository extends BaseRepository implements IWalletRepository {
  constructor(db: KyselyDB) {
    super(db, 'WalletRepository');
  }

  async create(request: NewWalletAddress): Promise<void> {
    try {
      const result = await this.db
        .insertInto('wallet_addresses')
        .values(request)
        .returning('id')
        .executeTakeFirstOrThrow();

      this.logger.debug(
        { address: request.address, blockchain: request.blockchain, id: result.id },
        'Wallet address created'
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Wallet address ${request.address} already exists for blockchain ${request.blockchain}`);
      }
      throw error;
    }
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.deleteFrom('wallet_addresses').where('id', '=', id).execute();

    const deleted = Number(result[0]?.numDeletedRows || 0) > 0;
    this.logger.debug({ deleted, id }, 'Wallet address delete attempt');

    return deleted;
  }

  async findByAddress(address: string, blockchain: string): Promise<WalletAddress | undefined> {
    return await this.db
      .selectFrom('wallet_addresses')
      .selectAll()
      .where('address', '=', address)
      .where('blockchain', '=', blockchain)
      .executeTakeFirst();
  }

  async findByAddressNormalized(normalizedAddress: string, blockchain: string): Promise<WalletAddress | undefined> {
    let dbQuery = this.db.selectFrom('wallet_addresses').selectAll();

    if (blockchain === 'ethereum') {
      // For Ethereum, do case-insensitive matching by comparing lowercase addresses
      dbQuery = dbQuery
        .where((eb) => eb.fn('lower', ['address']), '=', normalizedAddress)
        .where('blockchain', '=', blockchain);
    } else {
      dbQuery = dbQuery.where('address', '=', normalizedAddress).where('blockchain', '=', blockchain);
    }

    const row = await dbQuery.executeTakeFirst();
    return row ? row : undefined;
  }

  async findById(id: number): Promise<WalletAddress | undefined> {
    const row = await this.db.selectFrom('wallet_addresses').selectAll().where('id', '=', id).executeTakeFirst();

    return row ? row : undefined;
  }

  async update(id: number, updates: WalletAddressUpdate): Promise<void> {
    await this.db.updateTable('wallet_addresses').set(updates).where('id', '=', id).execute();

    this.logger.debug({ id, updates: updates }, 'Wallet address updated');
  }
}
