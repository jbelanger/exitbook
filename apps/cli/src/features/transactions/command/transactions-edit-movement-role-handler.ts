import type { CreateOverrideEventOptions, MovementRole } from '@exitbook/core';
import { materializeStoredTransactionMovementRoleOverrides, type OverrideStore } from '@exitbook/data/overrides';
import { markDownstreamProjectionsStale } from '@exitbook/data/projections';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import {
  toTransactionEditTransactionSummary,
  type TransactionEditTarget,
  type TransactionEditTransactionSummary,
} from './transaction-edit-target.js';
import {
  toTransactionEditMovementSummary,
  type ResolvedTransactionMovementSelector,
  type TransactionEditMovementSummary,
} from './transaction-movement-selector.js';
import {
  buildReprocessRequiredTransactionEditState,
  buildSynchronizedTransactionEditState,
  type TransactionEditProjectionSyncState,
} from './transactions-edit-result.js';

type TransactionMovementRoleEditOverrideStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type TransactionMovementRoleEditDatabase = DataSession;

interface TransactionMovementRoleStateLookup {
  findStoredMovementRoleStateByFingerprint(
    movementFingerprint: string
  ): Promise<Result<{ baseRole: MovementRole; overrideRole?: MovementRole | undefined } | undefined, Error>>;
}

interface TransactionMovementRoleEditBaseParams {
  movement: ResolvedTransactionMovementSelector;
  profileKey: string;
  reason?: string | undefined;
  target: TransactionEditTarget;
}

interface TransactionMovementRoleSetParams extends TransactionMovementRoleEditBaseParams {
  role: MovementRole;
}

type TransactionMovementRoleClearParams = TransactionMovementRoleEditBaseParams;

export interface TransactionMovementRoleEditResult extends TransactionEditProjectionSyncState {
  action: 'set' | 'clear';
  changed: boolean;
  movement: TransactionEditMovementSummary;
  nextEffectiveRole: MovementRole;
  previousEffectiveRole: MovementRole;
  reason?: string | undefined;
  transaction: TransactionEditTransactionSummary;
}

export class TransactionsEditMovementRoleHandler {
  constructor(
    private readonly db: TransactionMovementRoleEditDatabase,
    private readonly overrideStore: TransactionMovementRoleEditOverrideStore
  ) {}

  async setRole(params: TransactionMovementRoleSetParams): Promise<Result<TransactionMovementRoleEditResult, Error>> {
    const compatibilityResult = validateMovementRoleCompatibility(params.movement.direction, params.role);
    if (compatibilityResult.isErr()) {
      return err(compatibilityResult.error);
    }

    const storedStateResult = await this.readStoredMovementRoleState(
      this.db.transactions,
      params.movement.movement.movementFingerprint
    );
    if (storedStateResult.isErr()) {
      return err(storedStateResult.error);
    }

    const previousEffectiveRole = storedStateResult.value.overrideRole ?? storedStateResult.value.baseRole;
    if (previousEffectiveRole === params.role) {
      return ok(
        buildMovementRoleEditResult(params, 'set', false, previousEffectiveRole, params.role, {
          ...buildSynchronizedTransactionEditState(),
        })
      );
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'transaction-movement-role',
      payload: {
        type: 'transaction_movement_role_override',
        action: 'set',
        movement_fingerprint: params.movement.movement.movementFingerprint,
        movement_role: params.role,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const materializeResult = await this.materializeMovementRole(params.profileKey, params.target.transactionId);
    if (materializeResult.isErr()) {
      return ok(
        buildMovementRoleEditResult(params, 'set', true, previousEffectiveRole, params.role, {
          ...buildReprocessRequiredTransactionEditState([
            `Override persisted, but transaction movement role materialization failed: ${materializeResult.error.message}`,
          ]),
        })
      );
    }

    const invalidateResult = await this.invalidateDownstream(params.target.accountId);
    if (invalidateResult.isErr()) {
      return ok(
        buildMovementRoleEditResult(params, 'set', true, previousEffectiveRole, params.role, {
          ...buildReprocessRequiredTransactionEditState([
            `Override persisted, but downstream projections could not be marked stale: ${invalidateResult.error.message}`,
          ]),
        })
      );
    }

    return ok(
      buildMovementRoleEditResult(params, 'set', true, previousEffectiveRole, params.role, {
        ...buildSynchronizedTransactionEditState(),
      })
    );
  }

  async clearRole(
    params: TransactionMovementRoleClearParams
  ): Promise<Result<TransactionMovementRoleEditResult, Error>> {
    const storedStateResult = await this.readStoredMovementRoleState(
      this.db.transactions,
      params.movement.movement.movementFingerprint
    );
    if (storedStateResult.isErr()) {
      return err(storedStateResult.error);
    }

    const existingOverride = storedStateResult.value.overrideRole;
    const baseRole = storedStateResult.value.baseRole;
    const previousEffectiveRole = existingOverride ?? baseRole;

    if (existingOverride === undefined) {
      return ok(
        buildMovementRoleEditResult(params, 'clear', false, previousEffectiveRole, baseRole, {
          ...buildSynchronizedTransactionEditState(),
        })
      );
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'transaction-movement-role',
      payload: {
        type: 'transaction_movement_role_override',
        action: 'clear',
        movement_fingerprint: params.movement.movement.movementFingerprint,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const materializeResult = await this.materializeMovementRole(params.profileKey, params.target.transactionId);
    if (materializeResult.isErr()) {
      return ok(
        buildMovementRoleEditResult(params, 'clear', true, previousEffectiveRole, baseRole, {
          ...buildReprocessRequiredTransactionEditState([
            `Override persisted, but transaction movement role materialization failed: ${materializeResult.error.message}`,
          ]),
        })
      );
    }

    const invalidateResult = await this.invalidateDownstream(params.target.accountId);
    if (invalidateResult.isErr()) {
      return ok(
        buildMovementRoleEditResult(params, 'clear', true, previousEffectiveRole, baseRole, {
          ...buildReprocessRequiredTransactionEditState([
            `Override persisted, but downstream projections could not be marked stale: ${invalidateResult.error.message}`,
          ]),
        })
      );
    }

    return ok(
      buildMovementRoleEditResult(params, 'clear', true, previousEffectiveRole, baseRole, {
        ...buildSynchronizedTransactionEditState(),
      })
    );
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write transaction movement role override event: ${appendResult.error.message}`));
    }

    return ok(undefined);
  }

  private async materializeMovementRole(profileKey: string, transactionId: number): Promise<Result<void, Error>> {
    const materializeResult = await materializeStoredTransactionMovementRoleOverrides(
      this.db.transactions,
      this.overrideStore,
      profileKey,
      {
        transactionIds: [transactionId],
      }
    );
    if (materializeResult.isErr()) {
      return err(
        new Error(`Failed to materialize transaction movement role override: ${materializeResult.error.message}`)
      );
    }

    return ok(undefined);
  }

  private async invalidateDownstream(accountId: number): Promise<Result<void, Error>> {
    return markDownstreamProjectionsStale({
      accountIds: [accountId],
      db: this.db,
      from: 'processed-transactions',
      reason: 'override:transaction-movement-role',
    });
  }

  private async readStoredMovementRoleState(
    transactions: TransactionMovementRoleStateLookup,
    movementFingerprint: string
  ): Promise<Result<{ baseRole: MovementRole; overrideRole?: MovementRole | undefined }, Error>> {
    const result = await transactions.findStoredMovementRoleStateByFingerprint(movementFingerprint);
    if (result.isErr()) {
      return err(result.error);
    }

    if (!result.value) {
      return err(new Error(`Stored movement role state not found for ${movementFingerprint}`));
    }

    return ok(result.value);
  }
}

function validateMovementRoleCompatibility(
  direction: ResolvedTransactionMovementSelector['direction'],
  role: MovementRole
): Result<void, Error> {
  if (direction === 'outflow' && (role === 'staking_reward' || role === 'refund_rebate')) {
    return err(new Error(`${role} is only valid on inflow movements`));
  }

  return ok(undefined);
}

function buildMovementRoleEditResult(
  params: TransactionMovementRoleEditBaseParams,
  action: 'set' | 'clear',
  changed: boolean,
  previousEffectiveRole: MovementRole,
  nextEffectiveRole: MovementRole,
  syncState: TransactionEditProjectionSyncState
): TransactionMovementRoleEditResult {
  return {
    action,
    changed,
    movement: toTransactionEditMovementSummary(params.movement),
    nextEffectiveRole,
    previousEffectiveRole,
    reason: params.reason,
    transaction: toTransactionEditTransactionSummary(params.target),
    ...syncState,
  };
}
