import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { aiConversations, aiMessages, tenantUsers, users } from '@beaconhs/db/schema'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import { parseDatetimeLocal } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'

type Search = Record<string, string | string[] | undefined>

/** Administrative usage metadata only. Conversation contents stay private. */
export async function loadAssistantActivity(ctx: RequestContext, sp: Search) {
  assertCan(ctx, 'admin.audit.read')
  const params = parseListParams(sp, {
    sort: 'updated_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: ['updated_at'],
  })
  const userId = pickString(sp.user)
  const outcome = pickString(sp.outcome)
  const from = parseDatetimeLocal(pickString(sp.from) ?? '', ctx.timezone)
  const to = parseDatetimeLocal(`${pickString(sp.to) ?? ''}T23:59:59.999`, ctx.timezone)
  const term = params.q ? `%${params.q.replace(/[\\%_]/g, '\\$&')}%` : null

  return ctx.db(async (tx) => {
    const usage = tx.$with('assistant_usage').as(
      tx
        .select({
          conversationId: aiMessages.conversationId,
          prompts: sql<number>`count(*) filter (where ${aiMessages.role} = 'user')::int`.as(
            'prompts',
          ),
          replies: sql<number>`count(*) filter (where ${aiMessages.role} = 'assistant')::int`.as(
            'replies',
          ),
          failed:
            sql<number>`count(*) filter (where ${aiMessages.role} = 'assistant' and ${aiMessages.data}->>'status' = 'failed')::int`.as(
              'failed',
            ),
          stopped:
            sql<number>`count(*) filter (where ${aiMessages.role} = 'assistant' and ${aiMessages.data}->>'status' = 'stopped')::int`.as(
              'stopped',
            ),
          firstUsed: sql<Date>`min(${aiMessages.createdAt})`
            .mapWith(aiMessages.createdAt)
            .as('first_used'),
          lastUsed: sql<Date>`max(${aiMessages.createdAt})`
            .mapWith(aiMessages.createdAt)
            .as('last_used'),
        })
        .from(aiMessages)
        .innerJoin(
          aiConversations,
          and(
            eq(aiConversations.id, aiMessages.conversationId),
            eq(aiConversations.tenantId, aiMessages.tenantId),
          ),
        )
        .where(
          and(eq(aiConversations.scope, 'assistant'), eq(aiConversations.tenantId, ctx.tenantId)),
        )
        .groupBy(aiMessages.conversationId),
    )
    const actor = sql<string>`coalesce(${tenantUsers.displayName}, ${users.name})`
    const where = and(
      eq(aiConversations.tenantId, ctx.tenantId),
      eq(aiConversations.scope, 'assistant'),
      term ? or(ilike(users.name, term), ilike(tenantUsers.displayName, term)) : undefined,
      userId ? eq(aiConversations.userId, userId) : undefined,
      from ? gte(usage.lastUsed, from) : undefined,
      to ? lte(usage.lastUsed, to) : undefined,
      outcome === 'failed' ? sql`${usage.failed} > 0` : undefined,
      outcome === 'stopped' ? sql`${usage.stopped} > 0` : undefined,
      outcome === 'unanswered' ? sql`${usage.prompts} > ${usage.replies}` : undefined,
    )
    const query = () =>
      tx
        .with(usage)
        .select({
          id: aiConversations.id,
          userName: actor,
          prompts: usage.prompts,
          replies: usage.replies,
          failed: usage.failed,
          stopped: usage.stopped,
          firstUsed: usage.firstUsed,
          lastUsed: usage.lastUsed,
        })
        .from(aiConversations)
        .innerJoin(usage, eq(usage.conversationId, aiConversations.id))
        .leftJoin(users, eq(users.id, aiConversations.userId))
        .leftJoin(
          tenantUsers,
          and(
            eq(tenantUsers.userId, aiConversations.userId),
            eq(tenantUsers.tenantId, ctx.tenantId),
          ),
        )
        .where(where)
    const rows = await query()
      .orderBy(desc(usage.lastUsed), desc(aiConversations.id))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const filtered = query().as('filtered_assistant_usage')
    const [totals] = await tx
      .with(usage)
      .select({
        conversations: sql<number>`count(*)::int`,
        prompts: sql<number>`coalesce(sum(${filtered.prompts}), 0)::int`,
        replies: sql<number>`coalesce(sum(${filtered.replies}), 0)::int`,
      })
      .from(filtered)
    const actors = await tx
      .selectDistinct({ value: aiConversations.userId, label: actor })
      .from(aiConversations)
      .innerJoin(users, eq(users.id, aiConversations.userId))
      .leftJoin(
        tenantUsers,
        and(eq(tenantUsers.userId, aiConversations.userId), eq(tenantUsers.tenantId, ctx.tenantId)),
      )
      .where(
        and(eq(aiConversations.scope, 'assistant'), eq(aiConversations.tenantId, ctx.tenantId)),
      )
      .orderBy(actor)
      .limit(500)
    return {
      params,
      rows,
      totals: totals ?? { conversations: 0, prompts: 0, replies: 0 },
      actors: actors.filter((a): a is { value: string; label: string } => a.value !== null),
    }
  })
}
