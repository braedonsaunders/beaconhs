'use server'

// Server actions for the People workforce taxonomies — trades and crews. Both
// are flat name lists people are assigned to (people.tradeId / people.crewId).
// Create + rename run through save*(returns {ok|error} for the flyout); delete
// is a row form action that refuses while the taxonomy is still assigned.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, count, eq, isNull } from 'drizzle-orm'
import { crews, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

type SaveResult = { ok: true } | { ok: false; error: string }

const TRADES_BASE = '/people/trades'
const CREWS_BASE = '/people/crews'

export async function saveTrade(input: { id?: string; name: string }): Promise<SaveResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx.select().from(trades).where(eq(trades.id, input.id!)).limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Trade not found.' }
    await ctx.db((tx) => tx.update(trades).set({ name }).where(eq(trades.id, input.id!)))
    await recordAudit(ctx, {
      entityType: 'trade',
      entityId: input.id,
      action: 'update',
      summary: `Renamed trade "${before.name}" → "${name}"`,
      before: { name: before.name },
      after: { name },
    })
    revalidatePath(TRADES_BASE)
    return { ok: true }
  }

  const [row] = await ctx.db((tx) =>
    tx.insert(trades).values({ tenantId: ctx.tenantId, name }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'trade',
      entityId: row.id,
      action: 'create',
      summary: `Added trade "${name}"`,
      after: { name },
    })
  }
  revalidatePath(TRADES_BASE)
  return { ok: true }
}

export async function deleteTrade(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { row, usage } = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(trades).where(eq(trades.id, id)).limit(1)
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.tradeId, id), isNull(people.deletedAt)))
    return { row: r ?? null, usage: Number(u?.c ?? 0) }
  })
  if (!row) return
  if (usage > 0) {
    revalidatePath(TRADES_BASE)
    redirect(
      `${TRADES_BASE}?error=${encodeURIComponent(
        `"${row.name}" is assigned to ${usage} ${usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
      )}`,
    )
  }
  await ctx.db((tx) => tx.delete(trades).where(eq(trades.id, id)))
  await recordAudit(ctx, {
    entityType: 'trade',
    entityId: id,
    action: 'delete',
    summary: `Deleted trade "${row.name}"`,
    before: { name: row.name },
  })
  revalidatePath(TRADES_BASE)
  redirect(TRADES_BASE)
}

export async function saveCrew(input: { id?: string; name: string }): Promise<SaveResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx.select().from(crews).where(eq(crews.id, input.id!)).limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Crew not found.' }
    await ctx.db((tx) => tx.update(crews).set({ name }).where(eq(crews.id, input.id!)))
    await recordAudit(ctx, {
      entityType: 'crew',
      entityId: input.id,
      action: 'update',
      summary: `Renamed crew "${before.name}" → "${name}"`,
      before: { name: before.name },
      after: { name },
    })
    revalidatePath(CREWS_BASE)
    return { ok: true }
  }

  const [row] = await ctx.db((tx) =>
    tx.insert(crews).values({ tenantId: ctx.tenantId, name }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'crew',
      entityId: row.id,
      action: 'create',
      summary: `Added crew "${name}"`,
      after: { name },
    })
  }
  revalidatePath(CREWS_BASE)
  return { ok: true }
}

export async function deleteCrew(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { row, usage } = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(crews).where(eq(crews.id, id)).limit(1)
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.crewId, id), isNull(people.deletedAt)))
    return { row: r ?? null, usage: Number(u?.c ?? 0) }
  })
  if (!row) return
  if (usage > 0) {
    revalidatePath(CREWS_BASE)
    redirect(
      `${CREWS_BASE}?error=${encodeURIComponent(
        `"${row.name}" is assigned to ${usage} ${usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
      )}`,
    )
  }
  await ctx.db((tx) => tx.delete(crews).where(eq(crews.id, id)))
  await recordAudit(ctx, {
    entityType: 'crew',
    entityId: id,
    action: 'delete',
    summary: `Deleted crew "${row.name}"`,
    before: { name: row.name },
  })
  revalidatePath(CREWS_BASE)
  redirect(CREWS_BASE)
}
