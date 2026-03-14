import { err, ok, type Result } from '@exitbook/core';

import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

export interface CostBasisDependencyVersionRow {
  dependencyName: string;
  version: number;
  lastMutatedAt: Date;
}

export class CostBasisDependencyVersionRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'cost-basis-dependency-version-repository');
  }

  async getVersion(dependencyName: string): Promise<Result<CostBasisDependencyVersionRow, Error>> {
    try {
      const row = await this.db
        .selectFrom('cost_basis_dependency_versions')
        .selectAll()
        .where('dependency_name', '=', dependencyName)
        .executeTakeFirst();

      if (!row) {
        return ok({
          dependencyName,
          version: 0,
          lastMutatedAt: new Date(0),
        });
      }

      return ok({
        dependencyName: row.dependency_name,
        version: row.version,
        lastMutatedAt: new Date(row.last_mutated_at),
      });
    } catch (error) {
      this.logger.error({ error, dependencyName }, 'Failed to load cost-basis dependency version');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async bumpVersion(dependencyName: string): Promise<Result<CostBasisDependencyVersionRow, Error>> {
    try {
      const current = await this.getVersion(dependencyName);
      if (current.isErr()) {
        return err(current.error);
      }

      const nextVersion = current.value.version + 1;
      const mutatedAt = new Date();

      await this.db
        .insertInto('cost_basis_dependency_versions')
        .values({
          dependency_name: dependencyName,
          version: nextVersion,
          last_mutated_at: mutatedAt.toISOString(),
        })
        .onConflict((oc) =>
          oc.column('dependency_name').doUpdateSet({
            version: nextVersion,
            last_mutated_at: mutatedAt.toISOString(),
          })
        )
        .execute();

      return ok({
        dependencyName,
        version: nextVersion,
        lastMutatedAt: mutatedAt,
      });
    } catch (error) {
      this.logger.error({ error, dependencyName }, 'Failed to bump cost-basis dependency version');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
