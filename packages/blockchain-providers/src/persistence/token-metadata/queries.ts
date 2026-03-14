/* eslint-disable unicorn/no-null -- null required for db */
import { type AssetReferenceStatus, type TokenMetadataRecord, wrapError, pickLatestDate } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Kysely, Selectable } from '@exitbook/sqlite';

import type { TokenMetadataDatabase } from './schema.js';

const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PLATFORM_MAPPING_STALENESS_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type TokenMetadataRow = TokenMetadataDatabase['token_metadata'];
type TokenMetadataSelectableRow = Selectable<TokenMetadataRow>;
type TokenReferenceMatchRow = TokenMetadataDatabase['token_reference_matches'];
type TokenReferenceMatchSelectableRow = Selectable<TokenReferenceMatchRow>;
type ReferencePlatformMappingRow = TokenMetadataDatabase['reference_platform_mappings'];
type ReferencePlatformMappingSelectableRow = Selectable<ReferencePlatformMappingRow>;

export interface TokenReferenceMatchRecord {
  assetPlatformId?: string | undefined;
  blockchain: string;
  contractAddress: string;
  externalAssetId?: string | undefined;
  externalContractAddress?: string | undefined;
  externalName?: string | undefined;
  externalSymbol?: string | undefined;
  provider: string;
  referenceStatus: AssetReferenceStatus;
  refreshedAt: Date;
}

export interface ReferencePlatformMappingRecord {
  assetPlatformId: string;
  blockchain: string;
  chainIdentifier?: number | undefined;
  provider: string;
  refreshedAt: Date;
}

function fromSqliteBoolean(value: number | null): boolean | undefined {
  if (value === null) return undefined;
  return value === 1;
}

function toSqliteBoolean(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

function parseLatestRefreshAt(value: string | null | undefined, fieldName: string): Result<Date | undefined, Error> {
  if (!value) {
    return ok(undefined);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return err(new Error(`Invalid ${fieldName}: ${value}`));
  }

  return ok(parsed);
}

function mapTokenReferenceMatchRow(row: TokenReferenceMatchSelectableRow): TokenReferenceMatchRecord {
  return {
    blockchain: row.blockchain,
    contractAddress: row.contract_address,
    provider: row.provider,
    referenceStatus: row.reference_status,
    assetPlatformId: row.asset_platform_id ?? undefined,
    externalAssetId: row.external_asset_id ?? undefined,
    externalName: row.external_name ?? undefined,
    externalSymbol: row.external_symbol ?? undefined,
    externalContractAddress: row.external_contract_address ?? undefined,
    refreshedAt: new Date(row.refreshed_at),
  };
}

function mapReferencePlatformMappingRow(row: ReferencePlatformMappingSelectableRow): ReferencePlatformMappingRecord {
  return {
    blockchain: row.blockchain,
    provider: row.provider,
    assetPlatformId: row.asset_platform_id,
    chainIdentifier: row.chain_identifier ?? undefined,
    refreshedAt: new Date(row.refreshed_at),
  };
}

/**
 * Query module for token metadata storage and retrieval.
 * Stores token information by contract address with symbol indexing for reverse lookups.
 */
export function createTokenMetadataQueries(db: Kysely<TokenMetadataDatabase>) {
  const logger = getLogger('token-metadata-queries');

  function mapTokenMetadataRow(row: TokenMetadataSelectableRow): TokenMetadataRecord {
    return {
      blockchain: row.blockchain,
      contractAddress: row.contract_address,
      symbol: row.symbol ?? undefined,
      name: row.name ?? undefined,
      decimals: row.decimals ?? undefined,
      logoUrl: row.logo_url ?? undefined,
      possibleSpam: fromSqliteBoolean(row.possible_spam),
      verifiedContract: fromSqliteBoolean(row.verified_contract),
      description: row.description ?? undefined,
      externalUrl: row.external_url ?? undefined,
      totalSupply: row.total_supply ?? undefined,
      createdAt: row.created_at_provider ?? undefined,
      blockNumber: row.block_number ?? undefined,
      refreshedAt: new Date(row.refreshed_at),
      source: row.source,
    };
  }

  async function upsertSymbolIndex(
    blockchain: string,
    symbol: string,
    contractAddress: string
  ): Promise<Result<void, Error>> {
    try {
      const existing = await db
        .selectFrom('symbol_index')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('symbol', '=', symbol)
        .where('contract_address', '=', contractAddress)
        .executeTakeFirst();

      if (!existing) {
        await db
          .insertInto('symbol_index')
          .values({
            blockchain,
            symbol,
            contract_address: contractAddress,
            created_at: new Date().toISOString(),
          })
          .execute();
      }

      return ok(undefined);
    } catch (error) {
      logger.error({ error }, 'Failed to upsert symbol index');
      return wrapError(error, 'Failed to upsert symbol index');
    }
  }

  async function deleteSymbolIndex(
    blockchain: string,
    symbol: string,
    contractAddress: string
  ): Promise<Result<void, Error>> {
    try {
      await db
        .deleteFrom('symbol_index')
        .where('blockchain', '=', blockchain)
        .where('symbol', '=', symbol)
        .where('contract_address', '=', contractAddress)
        .execute();

      return ok(undefined);
    } catch (error) {
      logger.error({ error }, 'Failed to delete symbol index');
      return wrapError(error, 'Failed to delete symbol index');
    }
  }

  async function getByContract(
    blockchain: string,
    contractAddress: string
  ): Promise<Result<TokenMetadataRecord | undefined, Error>> {
    try {
      const row = await db
        .selectFrom('token_metadata')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('contract_address', '=', contractAddress)
        .executeTakeFirst();

      if (!row) {
        logger.debug(`Token metadata not found - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
        return ok(undefined);
      }

      const metadata = mapTokenMetadataRow(row);

      logger.debug(
        `Token metadata found - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${metadata.symbol ?? 'unknown'}`
      );
      return ok(metadata);
    } catch (error) {
      logger.error({ error }, 'Failed to get token metadata by contract');
      return wrapError(error, 'Failed to get token metadata by contract');
    }
  }

  async function getByContracts(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>> {
    try {
      if (contractAddresses.length === 0) {
        return ok(new Map());
      }

      const rows = await db
        .selectFrom('token_metadata')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('contract_address', 'in', contractAddresses)
        .execute();

      const metadataMap = new Map<string, TokenMetadataRecord | undefined>();

      for (const address of contractAddresses) {
        metadataMap.set(address, undefined);
      }

      for (const row of rows) {
        const metadata = mapTokenMetadataRow(row);
        metadataMap.set(row.contract_address, metadata);
      }

      logger.debug(
        `Batch token metadata lookup - Blockchain: ${blockchain}, Requested: ${contractAddresses.length}, Found: ${rows.length}`
      );

      return ok(metadataMap);
    } catch (error) {
      logger.error({ error }, 'Failed to get token metadata by contracts (batch)');
      return wrapError(error, 'Failed to get token metadata by contracts (batch)');
    }
  }

  async function getBySymbol(blockchain: string, symbol: string): Promise<Result<TokenMetadataRecord[], Error>> {
    try {
      const contracts = await db
        .selectFrom('symbol_index')
        .select('contract_address')
        .where('blockchain', '=', blockchain)
        .where('symbol', '=', symbol)
        .execute();

      if (contracts.length === 0) {
        logger.debug(`Token metadata not found for symbol - Blockchain: ${blockchain}, Symbol: ${symbol}`);
        return ok([]);
      }

      const results: TokenMetadataRecord[] = [];
      for (const { contract_address } of contracts) {
        const metadataResult = await getByContract(blockchain, contract_address);
        if (metadataResult.isOk() && metadataResult.value) {
          results.push(metadataResult.value);
        }
      }

      logger.debug(
        `Token metadata found for symbol - Blockchain: ${blockchain}, Symbol: ${symbol}, Contracts found: ${results.length}`
      );
      return ok(results);
    } catch (error) {
      logger.error({ error }, 'Failed to get token metadata by symbol');
      return wrapError(error, 'Failed to get token metadata by symbol');
    }
  }

  async function save(
    blockchain: string,
    contractAddress: string,
    metadata: TokenMetadataRecord
  ): Promise<Result<void, Error>> {
    try {
      const now = new Date().toISOString();

      const existingResult = await getByContract(blockchain, contractAddress);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      const existing = existingResult.value;

      const mergedSymbol = metadata.symbol !== undefined ? metadata.symbol : (existing?.symbol ?? null);
      const mergedName = metadata.name !== undefined ? metadata.name : (existing?.name ?? null);
      const mergedDecimals = metadata.decimals !== undefined ? metadata.decimals : (existing?.decimals ?? null);
      const mergedLogoUrl = metadata.logoUrl !== undefined ? metadata.logoUrl : (existing?.logoUrl ?? null);

      const mergedPossibleSpam =
        metadata.possibleSpam !== undefined
          ? toSqliteBoolean(metadata.possibleSpam)
          : toSqliteBoolean(existing?.possibleSpam);
      const mergedVerifiedContract =
        metadata.verifiedContract !== undefined
          ? toSqliteBoolean(metadata.verifiedContract)
          : toSqliteBoolean(existing?.verifiedContract);

      const mergedDescription =
        metadata.description !== undefined ? metadata.description : (existing?.description ?? null);
      const mergedExternalUrl =
        metadata.externalUrl !== undefined ? metadata.externalUrl : (existing?.externalUrl ?? null);
      const mergedTotalSupply =
        metadata.totalSupply !== undefined ? metadata.totalSupply : (existing?.totalSupply ?? null);
      const mergedCreatedAt = metadata.createdAt !== undefined ? metadata.createdAt : (existing?.createdAt ?? null);
      const mergedBlockNumber =
        metadata.blockNumber !== undefined ? metadata.blockNumber : (existing?.blockNumber ?? null);

      await db
        .insertInto('token_metadata')
        .values({
          blockchain,
          contract_address: contractAddress,
          symbol: mergedSymbol,
          name: mergedName,
          decimals: mergedDecimals,
          logo_url: mergedLogoUrl,
          possible_spam: mergedPossibleSpam,
          verified_contract: mergedVerifiedContract,
          description: mergedDescription,
          external_url: mergedExternalUrl,
          total_supply: mergedTotalSupply,
          created_at_provider: mergedCreatedAt,
          block_number: mergedBlockNumber,
          source: metadata.source,
          refreshed_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['blockchain', 'contract_address']).doUpdateSet({
            symbol: mergedSymbol,
            name: mergedName,
            decimals: mergedDecimals,
            logo_url: mergedLogoUrl,
            possible_spam: mergedPossibleSpam,
            verified_contract: mergedVerifiedContract,
            description: mergedDescription,
            external_url: mergedExternalUrl,
            total_supply: mergedTotalSupply,
            created_at_provider: mergedCreatedAt,
            block_number: mergedBlockNumber,
            source: metadata.source,
            refreshed_at: now,
          })
        )
        .execute();

      if (existing?.symbol && existing.symbol !== mergedSymbol) {
        const deleteResult = await deleteSymbolIndex(blockchain, existing.symbol, contractAddress);
        if (deleteResult.isErr()) {
          logger.warn(
            `Failed to delete old symbol index - Blockchain: ${blockchain}, Contract: ${contractAddress}, Old Symbol: ${existing.symbol}, Error: ${deleteResult.error.message}`
          );
        }
      }

      if (mergedSymbol) {
        const symbolIndexResult = await upsertSymbolIndex(blockchain, mergedSymbol, contractAddress);
        if (symbolIndexResult.isErr()) {
          logger.warn(
            `Failed to update symbol index - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${mergedSymbol}, Error: ${symbolIndexResult.error.message}`
          );
        }
      }

      logger.debug(
        `Token metadata saved - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${mergedSymbol ?? 'unknown'}, Source: ${metadata.source}`
      );
      return ok(undefined);
    } catch (error) {
      logger.error({ error }, 'Failed to save token metadata');
      return wrapError(error, 'Failed to save token metadata');
    }
  }

  async function getReferenceMatch(
    blockchain: string,
    contractAddress: string,
    provider: string
  ): Promise<Result<TokenReferenceMatchRecord | undefined, Error>> {
    try {
      const row = await db
        .selectFrom('token_reference_matches')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('contract_address', '=', contractAddress)
        .where('provider', '=', provider)
        .executeTakeFirst();

      return ok(row ? mapTokenReferenceMatchRow(row) : undefined);
    } catch (error) {
      logger.error({ error }, 'Failed to get token reference match');
      return wrapError(error, 'Failed to get token reference match');
    }
  }

  async function getReferenceMatches(
    blockchain: string,
    contractAddresses: string[],
    provider: string
  ): Promise<Result<Map<string, TokenReferenceMatchRecord | undefined>, Error>> {
    try {
      if (contractAddresses.length === 0) {
        return ok(new Map<string, TokenReferenceMatchRecord | undefined>());
      }

      const rows = await db
        .selectFrom('token_reference_matches')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('provider', '=', provider)
        .where('contract_address', 'in', contractAddresses)
        .execute();

      const matches = new Map<string, TokenReferenceMatchRecord | undefined>();
      for (const contractAddress of contractAddresses) {
        matches.set(contractAddress, undefined);
      }

      for (const row of rows) {
        matches.set(row.contract_address, mapTokenReferenceMatchRow(row));
      }

      return ok(matches);
    } catch (error) {
      logger.error({ error }, 'Failed to get token reference matches');
      return wrapError(error, 'Failed to get token reference matches');
    }
  }

  async function saveReferenceMatch(record: TokenReferenceMatchRecord): Promise<Result<void, Error>> {
    try {
      const now = record.refreshedAt.toISOString();
      const referenceStatus = record.referenceStatus === 'unknown' ? 'unmatched' : record.referenceStatus;

      await db
        .insertInto('token_reference_matches')
        .values({
          blockchain: record.blockchain,
          contract_address: record.contractAddress,
          provider: record.provider,
          reference_status: referenceStatus,
          asset_platform_id: record.assetPlatformId ?? null,
          external_asset_id: record.externalAssetId ?? null,
          external_name: record.externalName ?? null,
          external_symbol: record.externalSymbol ?? null,
          external_contract_address: record.externalContractAddress ?? null,
          refreshed_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['blockchain', 'contract_address', 'provider']).doUpdateSet({
            reference_status: referenceStatus,
            asset_platform_id: record.assetPlatformId ?? null,
            external_asset_id: record.externalAssetId ?? null,
            external_name: record.externalName ?? null,
            external_symbol: record.externalSymbol ?? null,
            external_contract_address: record.externalContractAddress ?? null,
            refreshed_at: now,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      logger.error({ error }, 'Failed to save token reference match');
      return wrapError(error, 'Failed to save token reference match');
    }
  }

  async function getReferencePlatformMapping(
    blockchain: string,
    provider: string
  ): Promise<Result<ReferencePlatformMappingRecord | undefined, Error>> {
    try {
      const row = await db
        .selectFrom('reference_platform_mappings')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('provider', '=', provider)
        .executeTakeFirst();

      return ok(row ? mapReferencePlatformMappingRow(row) : undefined);
    } catch (error) {
      logger.error({ error }, 'Failed to get reference platform mapping');
      return wrapError(error, 'Failed to get reference platform mapping');
    }
  }

  async function saveReferencePlatformMapping(record: ReferencePlatformMappingRecord): Promise<Result<void, Error>> {
    try {
      const now = record.refreshedAt.toISOString();

      await db
        .insertInto('reference_platform_mappings')
        .values({
          blockchain: record.blockchain,
          provider: record.provider,
          asset_platform_id: record.assetPlatformId,
          chain_identifier: record.chainIdentifier ?? null,
          refreshed_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['blockchain', 'provider']).doUpdateSet({
            asset_platform_id: record.assetPlatformId,
            chain_identifier: record.chainIdentifier ?? null,
            refreshed_at: now,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      logger.error({ error }, 'Failed to save reference platform mapping');
      return wrapError(error, 'Failed to save reference platform mapping');
    }
  }

  async function getLatestRefreshAt(): Promise<Result<Date | undefined, Error>> {
    try {
      const [tokenMetadataRow, referenceMatchRow, platformMappingRow] = await Promise.all([
        db
          .selectFrom('token_metadata')
          .select(({ fn }) => [fn.max<string>('refreshed_at').as('latest')])
          .executeTakeFirst(),
        db
          .selectFrom('token_reference_matches')
          .select(({ fn }) => [fn.max<string>('refreshed_at').as('latest')])
          .executeTakeFirst(),
        db
          .selectFrom('reference_platform_mappings')
          .select(({ fn }) => [fn.max<string>('refreshed_at').as('latest')])
          .executeTakeFirst(),
      ]);

      const latestTokenMetadataAt = parseLatestRefreshAt(tokenMetadataRow?.latest, 'token metadata refreshed_at');
      if (latestTokenMetadataAt.isErr()) {
        return err(latestTokenMetadataAt.error);
      }

      const latestReferenceMatchAt = parseLatestRefreshAt(
        referenceMatchRow?.latest,
        'token reference match refreshed_at'
      );
      if (latestReferenceMatchAt.isErr()) {
        return err(latestReferenceMatchAt.error);
      }

      const latestPlatformMappingAt = parseLatestRefreshAt(
        platformMappingRow?.latest,
        'reference platform mapping refreshed_at'
      );
      if (latestPlatformMappingAt.isErr()) {
        return err(latestPlatformMappingAt.error);
      }

      return ok(
        pickLatestDate(latestTokenMetadataAt.value, latestReferenceMatchAt.value, latestPlatformMappingAt.value)
      );
    } catch (error) {
      logger.error({ error }, 'Failed to load latest token metadata refresh timestamp');
      return wrapError(error, 'Failed to load latest token metadata refresh timestamp');
    }
  }

  function isStale(updatedAt: Date): boolean {
    const now = new Date();
    const ageMs = now.getTime() - updatedAt.getTime();
    return ageMs > STALENESS_THRESHOLD_MS;
  }

  function isReferenceStale(updatedAt: Date): boolean {
    const now = new Date();
    const ageMs = now.getTime() - updatedAt.getTime();
    return ageMs > STALENESS_THRESHOLD_MS;
  }

  function isReferencePlatformMappingStale(updatedAt: Date): boolean {
    const now = new Date();
    const ageMs = now.getTime() - updatedAt.getTime();
    return ageMs > PLATFORM_MAPPING_STALENESS_THRESHOLD_MS;
  }

  function refreshInBackground(
    blockchain: string,
    contractAddress: string,
    fetchFn: () => Promise<Result<TokenMetadataRecord, Error>>
  ): void {
    (async () => {
      try {
        logger.debug(`Background refresh started - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
        const result = await fetchFn();
        if (result.isOk()) {
          const saveResult = await save(blockchain, contractAddress, result.value);
          if (saveResult.isErr()) {
            logger.warn(
              `Background refresh failed to update - Blockchain: ${blockchain}, Contract: ${contractAddress}, Error: ${saveResult.error.message}`
            );
          } else {
            logger.debug(`Background refresh completed - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
          }
        } else {
          logger.warn(
            `Background refresh failed to fetch data - Blockchain: ${blockchain}, Contract: ${contractAddress}, Error: ${result.error.message}`
          );
        }
      } catch (error) {
        logger.error({ error }, `Background refresh error - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
      }
    })().catch((error) => {
      logger.error(
        { error },
        `Unhandled error in background refresh - Blockchain: ${blockchain}, Contract: ${contractAddress}`
      );
    });
  }

  return {
    getByContract,
    getByContracts,
    getBySymbol,
    save,
    getReferenceMatch,
    getReferenceMatches,
    saveReferenceMatch,
    getReferencePlatformMapping,
    saveReferencePlatformMapping,
    getLatestRefreshAt,
    isStale,
    isReferenceStale,
    isReferencePlatformMappingStale,
    refreshInBackground,
  };
}

export type TokenMetadataQueries = ReturnType<typeof createTokenMetadataQueries>;
