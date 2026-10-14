// Assistant tools for AI briefs: find briefs and their recent runs, and read
// one run with the facts and source records it cites, so the assistant can
// answer follow-up questions grounded in the same evidence the brief used.

import { z } from 'zod'
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { briefRuns, briefs, departments } from '@beaconhs/db/schema'
import { BRIEF_MANAGE_PERMISSION, BRIEF_READ_PERMISSION } from '@/lib/briefs/access'
import { truncateText, type AssistantToolDef, type ToolResult } from './types'

const GATE: AssistantToolDef['gate'] = {
  mode: 'anyOf',
  perms: [BRIEF_READ_PERMISSION, BRIEF_MANAGE_PERMISSION],
}

function escLike(q: string): string {
  return `%${q.slice(0, 100).replace(/[%_\\]/g, (m) => `\\${m}`)}%`
}

const findBriefs: AssistantToolDef = {
  name: 'find_briefs',
  description:
    "List AI briefs (scheduled AI-written summaries such as the daily company journal brief) with each brief's most recent runs. Use read_brief_run to open one. Read-only.",
  category: 'read',
  gate: GATE,
  inputSchema: z.object({
    query: z.string().max(100).optional().describe('Text to match in the brief name.'),
    runsPerBrief: z.number().int().min(1).max(10).optional(),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { query?: string; runsPerBrief?: number }
    const perBrief = a.runsPerBrief ?? 3
    return ctx.db(async (tx) => {
      const conds: SQL[] = [eq(briefs.status, 'active')]
      if (a.query) {
        const match = or(
          ilike(briefs.name, escLike(a.query)),
          ilike(briefs.description, escLike(a.query)),
        )
        if (match) conds.push(match)
      }
      const where = and(...conds)
      const [rows, totalRow] = await Promise.all([
        tx
          .select({ id: briefs.id, name: briefs.name, description: briefs.description })
          .from(briefs)
          .where(where)
          .orderBy(briefs.name)
          .limit(20),
        tx.select({ c: count() }).from(briefs).where(where),
      ])
      const items = await Promise.all(
        rows.map(async (brief) => {
          const runs = await tx
            .select({
              id: briefRuns.id,
              status: briefRuns.status,
              trigger: briefRuns.trigger,
              window: briefRuns.windowLabel,
              department: departments.name,
              headline: briefRuns.result,
              finishedAt: briefRuns.finishedAt,
            })
            .from(briefRuns)
            .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
            .where(eq(briefRuns.briefId, brief.id))
            .orderBy(desc(briefRuns.createdAt))
            .limit(perBrief)
          return {
            ...brief,
            url: `/reports/briefs/${brief.id}`,
            recentRuns: runs.map((run) => ({
              ...run,
              headline: run.headline?.headline ?? null,
              url: `/reports/briefs/${brief.id}/runs/${run.id}`,
            })),
          }
        }),
      )
      const total = Number(totalRow[0]?.c ?? 0)
      return {
        ok: true,
        data: { total, returned: items.length, truncated: total > items.length, items },
      }
    })
  },
}

const readBriefRun: AssistantToolDef = {
  name: 'read_brief_run',
  description:
    'Read one AI brief run by id: the written brief (headline, summary, sections, follow-ups), the computed facts, and the source records each point cites (ref → module, title, date, url, text). Read-only.',
  category: 'read',
  gate: GATE,
  inputSchema: z.object({
    runId: z.string().uuid(),
    includeRecords: z
      .boolean()
      .optional()
      .describe('Include the cited source records (default true).'),
  }),
  execute: async (raw, ctx): Promise<ToolResult> => {
    const a = raw as { runId: string; includeRecords?: boolean }
    const [row] = await ctx.db((tx) =>
      tx
        .select({ run: briefRuns, department: departments.name })
        .from(briefRuns)
        .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
        .where(eq(briefRuns.id, a.runId))
        .limit(1),
    )
    if (!row) return { ok: false, error: 'not_found' }
    const { run } = row
    const records = a.includeRecords === false ? [] : (run.evidence?.records ?? [])
    return {
      ok: true,
      data: {
        id: run.id,
        brief: run.briefName,
        url: `/reports/briefs/${run.briefId}/runs/${run.id}`,
        status: run.status,
        error: run.error,
        window: run.windowLabel,
        timezone: run.timezone,
        department: row.department,
        result: run.result,
        facts: run.evidence?.facts ?? [],
        records: records.slice(0, 200).map((record) => ({
          ...record,
          excerpt: truncateText(record.excerpt, 600),
        })),
        recordsTruncated: records.length > 200,
      },
    }
  },
}

export const BRIEF_TOOLS: AssistantToolDef[] = [findBriefs, readBriefRun]
