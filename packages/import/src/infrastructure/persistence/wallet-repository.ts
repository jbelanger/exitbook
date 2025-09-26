import type {
  CreateWalletAddressRequest,
  UpdateWalletAddressRequest,
  WalletAddress,
  WalletAddressQuery,
} from '@crypto/data/src/types/data-types.ts';
import type { SQLParam } from '@crypto/data/src/types/database-types.ts';
import type sqlite3Module from 'sqlite3';

import type { IWalletRepository } from '../../app/ports/wallet-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

export class WalletRepository implements IWalletRepository {
  constructor(private db: SQLiteDatabase) {}

  async create(request: CreateWalletAddressRequest): Promise<WalletAddress> {
    return new Promise((resolve, reject) => {
      const now = Math.floor(Date.now() / 1000);
      const addressType = request.addressType || 'personal';

      const query = `
        INSERT INTO wallet_addresses (address, blockchain, label, address_type, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        query,
        [request.address, request.blockchain, request.label, addressType, request.notes, now, now],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              reject(
                new Error(`Wallet address ${request.address} already exists for blockchain ${request.blockchain}`)
              );
            } else {
              reject(err);
            }
          } else {
            // Fetch the created record
            resolve({
              address: request.address,
              addressType: addressType,
              blockchain: request.blockchain,
              createdAt: now,
              id: this.lastID,
              isActive: true,
              label: request.label ?? '',
              notes: request.notes ?? '',
              updatedAt: now,
            });
          }
        }
      );
    });
  }

  async delete(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const query = 'DELETE FROM wallet_addresses WHERE id = ?';

      this.db.run(query, [id], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  async findAll(query?: WalletAddressQuery): Promise<WalletAddress[]> {
    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM wallet_addresses';
      const conditions: string[] = [];
      const params: SQLParam[] = [];

      if (query) {
        if (query.blockchain) {
          conditions.push('blockchain = ?');
          params.push(query.blockchain);
        }
        if (query.addressType) {
          conditions.push('address_type = ?');
          params.push(query.addressType);
        }
        if (query.isActive !== undefined) {
          conditions.push('is_active = ?');
          params.push(query.isActive ? 1 : 0);
        }
        if (query.search) {
          conditions.push('(address LIKE ? OR label LIKE ? OR notes LIKE ?)');
          const searchTerm = `%${query.search}%`;
          params.push(searchTerm, searchTerm, searchTerm);
        }
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY created_at DESC';

      this.db.all(sql, params, (err, rows: WalletAddress[]) => {
        if (err) {
          reject(err);
        } else {
          const addresses = rows.map((row) => ({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          }));
          resolve(addresses);
        }
      });
    });
  }

  async findByAddress(address: string, blockchain: string): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM wallet_addresses WHERE address = ? AND blockchain = ?';

      this.db.get(query, [address, blockchain], (err, row: WalletAddress) => {
        if (err) {
          reject(err);
        } else if (!row) {
          return;
        } else {
          resolve({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          });
        }
      });
    });
  }

  async findByAddressNormalized(normalizedAddress: string, blockchain: string): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      // For Ethereum, do case-insensitive matching by comparing lowercase addresses
      let query: string;
      if (blockchain === 'ethereum') {
        query = 'SELECT * FROM wallet_addresses WHERE LOWER(address) = ? AND blockchain = ?';
      } else {
        query = 'SELECT * FROM wallet_addresses WHERE address = ? AND blockchain = ?';
      }

      this.db.get(query, [normalizedAddress, blockchain], (err, row: WalletAddress) => {
        if (err) {
          reject(err);
        } else if (!row) {
          return;
        } else {
          resolve({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          });
        }
      });
    });
  }

  async findById(id: number): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM wallet_addresses WHERE id = ?';

      this.db.get<WalletAddress>(query, [id], (err, row: WalletAddress | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          return;
        } else {
          resolve({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          });
        }
      });
    });
  }

  async update(id: number, updates: UpdateWalletAddressRequest): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      const now = Math.floor(Date.now() / 1000);
      const setParts: string[] = [];
      const params: SQLParam[] = [];

      if (updates.label !== undefined) {
        setParts.push('label = ?');
        params.push(updates.label);
      }
      if (updates.addressType !== undefined) {
        setParts.push('address_type = ?');
        params.push(updates.addressType);
      }
      if (updates.isActive !== undefined) {
        setParts.push('is_active = ?');
        params.push(updates.isActive ? 1 : 0);
      }
      if (updates.notes !== undefined) {
        setParts.push('notes = ?');
        params.push(updates.notes);
      }

      if (setParts.length === 0) {
        this.findById(id).then(resolve).catch(reject);
        return;
      }

      setParts.push('updated_at = ?');
      params.push(now);
      params.push(id);

      const query = `UPDATE wallet_addresses SET ${setParts.join(', ')} WHERE id = ?`;

      this.db.run(query, params, (err) => {
        if (err) {
          reject(err);
        } else {
          this.findById(id).then(resolve).catch(reject);
        }
      });
    });
  }
}
