import { BaseRepository } from '@crypto/data/src/repositories/base-repository.ts';
import type { KyselyDB } from '@crypto/data/src/storage/database.ts';
import type {
  CreateWalletAddressRequest,
  UpdateWalletAddressRequest,
  WalletAddress,
  WalletAddressQuery,
} from '@crypto/data/src/types/data-types.ts';

import type { IWalletRepository } from '../../app/ports/wallet-repository.ts';

/**
 * Maps database row to WalletAddress domain object
 */
function mapToWalletAddress(row: Record<string, unknown>): WalletAddress {
  return {
    address: row.address as string,
    addressType: row.address_type as 'personal' | 'exchange' | 'contract' | 'unknown',
    blockchain: row.blockchain as string,
    createdAt: row.created_at as number,
    id: row.id as number,
    isActive: Boolean(row.is_active ?? true),
    label: (row.label as string) ?? '',
    notes: (row.notes as string) ?? '',
    updatedAt: row.updated_at as number,
  };
}

/**
 * Kysely-based repository for wallet address database operations.
 * Handles storage and retrieval of WalletAddress entities using type-safe queries.
 */
export class WalletRepository extends BaseRepository implements IWalletRepository {
  constructor(db: KyselyDB) {
    super(db, 'WalletRepository');
  }

  async create(request: CreateWalletAddressRequest): Promise<WalletAddress> {
    const now = this.getCurrentTimestamp();
    const addressType = request.addressType || 'personal';

    try {
      const result = await this.db
        .insertInto('wallet_addresses')
        .values({
          address: request.address,
          address_type: addressType,
          blockchain: request.blockchain,
          created_at: this.getCurrentDateTimeForDB(),
          is_active: true,
          label: request.label,
          notes: request.notes,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const walletAddress: WalletAddress = {
        address: request.address,
        addressType: addressType,
        blockchain: request.blockchain,
        createdAt: now,
        id: result.id,
        isActive: true,
        label: request.label ?? '',
        notes: request.notes ?? '',
        updatedAt: now,
      };

      this.logger.debug(
        { address: request.address, blockchain: request.blockchain, id: result.id },
        'Wallet address created'
      );

      return walletAddress;
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

  async findAll(query?: WalletAddressQuery): Promise<WalletAddress[]> {
    let dbQuery = this.db.selectFrom('wallet_addresses').selectAll();

    // Apply filters
    if (query?.blockchain) {
      dbQuery = dbQuery.where('blockchain', '=', query.blockchain);
    }

    if (query?.addressType) {
      dbQuery = dbQuery.where('address_type', '=', query.addressType);
    }

    if (query?.isActive !== undefined) {
      dbQuery = dbQuery.where('is_active', '=', query.isActive);
    }

    if (query?.search) {
      const searchTerm = `%${query.search}%`;
      dbQuery = dbQuery.where((eb) =>
        eb.or([eb('address', 'like', searchTerm), eb('label', 'like', searchTerm), eb('notes', 'like', searchTerm)])
      );
    }

    // Apply ordering
    dbQuery = dbQuery.orderBy('created_at', 'desc');

    const rows = await dbQuery.execute();
    return rows.map(mapToWalletAddress);
  }

  async findByAddress(address: string, blockchain: string): Promise<WalletAddress | undefined> {
    const row = await this.db
      .selectFrom('wallet_addresses')
      .selectAll()
      .where('address', '=', address)
      .where('blockchain', '=', blockchain)
      .executeTakeFirst();

    return row ? mapToWalletAddress(row) : undefined;
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
    return row ? mapToWalletAddress(row) : undefined;
  }

  async findById(id: number): Promise<WalletAddress | undefined> {
    const row = await this.db.selectFrom('wallet_addresses').selectAll().where('id', '=', id).executeTakeFirst();

    return row ? mapToWalletAddress(row) : undefined;
  }

  async update(id: number, updates: UpdateWalletAddressRequest): Promise<WalletAddress | undefined> {
    const now = this.getCurrentTimestamp();
    const updateData: Record<string, unknown> = {
      updated_at: now,
    };

    if (updates.label !== undefined) {
      updateData.label = updates.label;
    }

    if (updates.addressType !== undefined) {
      updateData.address_type = updates.addressType;
    }

    if (updates.isActive !== undefined) {
      updateData.is_active = updates.isActive ? 1 : 0;
    }

    if (updates.notes !== undefined) {
      updateData.notes = updates.notes;
    }

    // Only update if there are actual changes besides updated_at
    const hasChanges = Object.keys(updateData).length > 1;
    if (!hasChanges) {
      return this.findById(id);
    }

    await this.db
      .updateTable('wallet_addresses')
      .set({
        address_type: updateData.address_type as 'personal' | 'exchange' | 'contract' | 'unknown' | undefined,
        is_active: updateData.is_active as boolean | undefined,
        label: updateData.label as string | undefined,
        notes: updateData.notes as string | undefined,
        updated_at: this.getCurrentDateTimeForDB(),
      })
      .where('id', '=', id)
      .execute();

    this.logger.debug({ id, updates: updateData }, 'Wallet address updated');

    return this.findById(id);
  }
}
