// Server half of the local-first record edits (see lib/offline-drafts).
//
// A record page queues field edits on the device and sends them, in batches,
// to /api/records/sync. Each module registers one saver (registry.ts) built
// from `defineRecordSaver`: it locks the record, checks permission,
// visibility and editability exactly like the module's own mutations, and
// then resolves every queued edit ("op") to a field it knows how to parse,
// format, and write.
//
// Every edit is a compare-and-set. The device sends the value it last saw on
// the server (`base`) with the new value:
// - the server still holds `base` → the new value is written;
// - the server already holds the new value → acknowledged without writing
//   (a retry whose first attempt landed but whose response was lost);
// - anything else → a conflict, reported with the server's current value, and
//   the field is left untouched for the worker to decide.
// Values are compared in their wire form (what the page renders and sends), so
// the module's `format` must produce exactly what its page passes to the field.

import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { pgError, type Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { jsonEqual } from '@/lib/offline-drafts/model'
import type {
  DraftSaveFailureReason,
  RecordSyncPatch,
  RecordSyncResult,
} from '@/lib/offline-drafts/protocol'

/**
 * The submitted value is invalid for this field (shown next to the field).
 * Any other `Error` thrown by an op's `parse` is treated the same way, so the
 * module's existing input validators can be reused as they are.
 */
export class RecordEditRejection extends Error {}

/** The whole request cannot apply (record missing, locked, not permitted). */
export class RecordSyncError extends Error {
  constructor(
    readonly reason: DraftSaveFailureReason,
    message: string,
  ) {
    super(message)
  }
}

export const recordNotFound = () => new RecordSyncError('not_found', 'This record was not found.')
export const recordLocked = (message = 'This record is locked.') =>
  new RecordSyncError('locked', message)
export const recordForbidden = (message = 'You do not have permission to edit this record.') =>
  new RecordSyncError('forbidden', message)

/** One editable field (or operation) resolved against the locked record. */
export type RecordOp<T = unknown> = {
  /** The stored value. */
  current: T
  /** Wire value → value to store. Throws (any `Error`) when the value is invalid. */
  parse: (wire: unknown) => T | Promise<T>
  /** Stored value → the wire value the page shows (and later sends as `base`). */
  format: (value: T) => unknown
  /**
   * Persist a parsed value that differs from `current` (inside a savepoint,
   * so a constraint failure rejects only this field). Update the loaded
   * record too, so later edits in the batch validate against it.
   */
  write: (value: T) => Promise<void>
}

declare const erased: unique symbol
/** A `RecordOp` whose value type has been checked and erased by `recordOp`. */
export type ErasedRecordOp = { readonly [erased]: true }

/** Type-check an op against its own value type, then erase it for the runner. */
export function recordOp<T>(op: RecordOp<T>): ErasedRecordOp {
  return op as unknown as ErasedRecordOp
}

export type RecordChange = { op: string; before: unknown; after: unknown }

export type RecordSaverSpec<L> = {
  /** Permission gate, checked before any database work. */
  authorize: (ctx: RequestContext) => boolean | Promise<boolean>
  /**
   * Inside the transaction: lock the record row, then check visibility and
   * editability. Throw `RecordSyncError` (not_found / locked / forbidden /
   * closed) when no edit can apply.
   */
  load: (tx: Database, ctx: RequestContext, recordId: string) => Promise<L>
  /** Resolve an op key (wrap the op in `recordOp`); null for one this record does not accept. */
  resolve: (
    tx: Database,
    ctx: RequestContext,
    loaded: L,
    op: string,
  ) => ErasedRecordOp | null | Promise<ErasedRecordOp | null>
  /** After the batch's writes, in the same transaction: audit, derived state, events. */
  afterWrites: (
    tx: Database,
    ctx: RequestContext,
    loaded: L,
    changes: RecordChange[],
  ) => Promise<void>
  /** Paths to revalidate once something changed. */
  revalidate: (recordId: string, loaded: L) => string[]
}

export type RecordSaver = (
  ctx: RequestContext,
  recordId: string,
  patches: RecordSyncPatch[],
) => Promise<RecordSyncResult>

function failure(reason: DraftSaveFailureReason, error: string): RecordSyncResult {
  return { ok: false, reason, error }
}

async function parsedFormat(op: RecordOp<unknown>, wire: unknown): Promise<unknown> {
  return op.format(await op.parse(wire))
}

/** True while the server still holds the value the device based its edit on. */
async function baseMatches(
  op: RecordOp<unknown>,
  currentWire: unknown,
  base: unknown,
): Promise<boolean> {
  if (jsonEqual(base, currentWire)) return true
  try {
    return jsonEqual(await parsedFormat(op, base), currentWire)
  } catch (error) {
    if (error instanceof RecordSyncError || pgError(error)) throw error
    return false
  }
}

function rejectionMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'This value is invalid.'
}

/** A database refusal that only this field caused (constraint or trigger). */
function fieldLevelDbError(error: unknown): string | null {
  const info = pgError(error)
  if (!info) return null
  // 22xxx data exceptions (overflow, bad format) and 23xxx integrity
  // violations come from this value alone: refuse it, don't retry forever.
  if (info.code.startsWith('22') || info.code.startsWith('23')) {
    return 'This value could not be saved.'
  }
  if (info.code === 'P0001' && error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    const message = cause instanceof Error ? cause.message : error.message
    return message.replace(/^Failed query:[\s\S]*$/, 'This value could not be saved.')
  }
  return null
}

type BatchOutcome<L> = {
  loaded: L
  applied: Array<{ fieldId: string; stored: unknown }>
  conflicts: Array<{ fieldId: string; current: unknown }>
  rejected: Array<{ fieldId: string; error: string }>
  changed: boolean
}

export function defineRecordSaver<L>(module: string, spec: RecordSaverSpec<L>): RecordSaver {
  return async (ctx, recordId, patches) => {
    if (!(await spec.authorize(ctx))) {
      return failure('forbidden', 'You do not have permission to edit this record.')
    }
    let outcome: BatchOutcome<L>
    try {
      outcome = await ctx.db(async (tx): Promise<BatchOutcome<L>> => {
        const loaded = await spec.load(tx, ctx, recordId)
        const result: BatchOutcome<L> = {
          loaded,
          applied: [],
          conflicts: [],
          rejected: [],
          changed: false,
        }
        const changes: RecordChange[] = []
        for (const patch of patches) {
          const op = (await spec.resolve(
            tx,
            ctx,
            loaded,
            patch.fieldId,
          )) as unknown as RecordOp<unknown> | null
          if (!op) {
            result.rejected.push({
              fieldId: patch.fieldId,
              error: 'This field can no longer be edited.',
            })
            continue
          }
          const currentWire = op.format(op.current)
          let next: unknown
          try {
            next = await op.parse(patch.value)
          } catch (error) {
            // Database failures abort the transaction: retry the batch later.
            if (error instanceof RecordSyncError || pgError(error)) throw error
            // An invalid value on a field that changed elsewhere is a
            // conflict first: the worker should see the newer value.
            if (await baseMatches(op, currentWire, patch.base)) {
              result.rejected.push({ fieldId: patch.fieldId, error: rejectionMessage(error) })
            } else {
              result.conflicts.push({ fieldId: patch.fieldId, current: currentWire })
            }
            continue
          }
          const nextWire = op.format(next)
          if (jsonEqual(nextWire, currentWire)) {
            result.applied.push({ fieldId: patch.fieldId, stored: currentWire })
            continue
          }
          if (!(await baseMatches(op, currentWire, patch.base))) {
            result.conflicts.push({ fieldId: patch.fieldId, current: currentWire })
            continue
          }
          const before = op.current
          await tx.execute(sql`savepoint record_sync_edit`)
          try {
            await op.write(next)
            await tx.execute(sql`release savepoint record_sync_edit`)
          } catch (error) {
            const message =
              error instanceof RecordEditRejection ? error.message : fieldLevelDbError(error)
            if (!message) throw error
            await tx.execute(sql`rollback to savepoint record_sync_edit`)
            result.rejected.push({ fieldId: patch.fieldId, error: message })
            continue
          }
          result.applied.push({ fieldId: patch.fieldId, stored: nextWire })
          changes.push({ op: patch.fieldId, before, after: next })
        }
        if (changes.length > 0) {
          await spec.afterWrites(tx, ctx, loaded, changes)
          result.changed = true
        }
        return result
      })
    } catch (error) {
      if (error instanceof RecordSyncError) return failure(error.reason, error.message)
      console.error(`[record-sync] ${module} save failed`, error)
      return failure('unavailable', 'Unable to save right now.')
    }
    if (outcome.changed) {
      for (const path of spec.revalidate(recordId, outcome.loaded)) revalidatePath(path)
    }
    return {
      ok: true,
      kind: 'fields',
      applied: outcome.applied,
      conflicts: outcome.conflicts,
      rejected: outcome.rejected,
    }
  }
}

/**
 * The audit trail the inline editors have always written: one "Updated
 * <field>" entry per changed field, with the stored value.
 */
export async function auditFieldChanges(
  tx: Database,
  ctx: RequestContext,
  entity: { entityType: string; entityId: string },
  changes: RecordChange[],
  describe: (change: RecordChange) => { summary: string; key?: string } = (change) => ({
    summary: `Updated ${change.op}`,
  }),
): Promise<void> {
  for (const change of changes) {
    const { summary, key } = describe(change)
    const field = key ?? change.op
    await recordAuditInTransaction(tx, ctx, {
      ...entity,
      action: 'update',
      summary,
      before: { [field]: change.before },
      after: { [field]: change.after },
    })
  }
}
