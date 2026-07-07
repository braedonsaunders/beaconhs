// Admin config for guided tours (walkthroughs): per-tour enable, auto-start on
// first sign-in, and role scoping — plus a Preview that runs the tour exactly
// as users see it (no progress is recorded in preview).

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
import { PlayCircle } from 'lucide-react'
import { Badge, Button, PageHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { roles } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { WALKTHROUGHS } from '@/lib/walkthroughs/registry'
import { loadWalkthroughSettings } from '@/lib/walkthroughs/service'
import { saveWalkthroughSetting } from './_actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Walkthroughs' }

export default async function AdminWalkthroughsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const [settings, roleRows] = await ctx.db((tx) =>
    Promise.all([
      loadWalkthroughSettings(tx),
      tx
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .orderBy(asc(roles.name)),
    ]),
  )
  const settingById = new Map(settings.map((s) => [s.walkthroughId, s]))

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          back={{ href: '/admin', label: 'Admin' }}
          title="Walkthroughs"
          description="Guided tours that highlight the real UI, step by step. Choose which tours are on, which start automatically for new users, and which roles see each one."
        />

        <div className="space-y-4">
          {WALKTHROUGHS.map((w) => {
            const s = settingById.get(w.id)!
            const scoped = s.roleIds.length > 0
            return (
              <form
                key={w.id}
                action={saveWalkthroughSetting}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <input type="hidden" name="walkthroughId" value={w.id} />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {w.title}
                      </h2>
                      {!s.enabled ? <Badge variant="secondary">Off</Badge> : null}
                      {s.enabled && s.autoStart ? <Badge>Auto-start</Badge> : null}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{w.description}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {w.steps.length} steps · starts on {w.startPath}
                    </p>
                  </div>
                  <Link
                    href={`${w.startPath}?walkthrough=${w.id}&wt_preview=1` as never}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 transition-colors hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200 dark:hover:bg-teal-950"
                  >
                    <PlayCircle size={15} /> Preview
                  </Link>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
                  <div className="space-y-2.5">
                    <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={s.enabled}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800"
                      />
                      <span>
                        <span className="font-medium">Enabled</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Off hides the tour from the User Guide and never auto-starts it.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        name="autoStart"
                        defaultChecked={s.autoStart}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800"
                      />
                      <span>
                        <span className="font-medium">Start automatically</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Runs once for each matching user who hasn't seen it.
                        </span>
                      </span>
                    </label>
                  </div>

                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Roles
                    </legend>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {scoped
                        ? 'Only the checked roles see this tour.'
                        : 'No roles checked — every role sees this tour.'}
                    </p>
                    <div className="mt-2 flex max-h-36 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto">
                      {roleRows.map((r) => (
                        <label
                          key={r.id}
                          className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300"
                        >
                          <input
                            type="checkbox"
                            name="roleIds"
                            value={r.id}
                            defaultChecked={s.roleIds.includes(r.id)}
                            className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800"
                          />
                          {r.name}
                        </label>
                      ))}
                      {roleRows.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          No roles defined yet.
                        </p>
                      ) : null}
                    </div>
                  </fieldset>
                </div>

                <div className="mt-4 flex justify-end">
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </div>
              </form>
            )
          })}
        </div>
      </div>
    </PageContainer>
  )
}
