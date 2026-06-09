// Notification preferences — per (category × channel) toggle.
//
// The notification_preferences table is upsert-keyed on
// (tenantId, userId, category, channel). Missing rows are implicitly enabled,
// matching how the worker's dispatch code already treats them. The form
// renders one row per category with checkboxes for each channel; submitting
// rewrites every (category, channel) pair the user touched.
//
// We expose a fixed canonical list of categories rather than a dynamic
// "categories we've seen in your inbox" list — that way the user can opt out
// of a category they have not yet received anything for (e.g. SMS for
// lone-worker alerts) before the first one lands.

import { revalidatePath } from 'next/cache'
import { Bell, BellOff } from 'lucide-react'
import { and, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  PageHeader,
} from '@beaconhs/ui'
import { notificationPreferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Notification preferences' }
export const dynamic = 'force-dynamic'

type Channel = 'in_app' | 'email' | 'push' | 'sms'

const CHANNELS: { key: Channel; label: string; hint: string }[] = [
  { key: 'in_app', label: 'In-app', hint: 'Inbox + bell badge' },
  { key: 'email', label: 'Email', hint: 'Sent to your account address' },
  { key: 'push', label: 'Web push', hint: 'Browser/desktop notifications' },
  { key: 'sms', label: 'SMS', hint: 'Text message (premium plans)' },
]

const CATEGORIES: { key: string; label: string; description: string }[] = [
  {
    key: 'incidents',
    label: 'Incidents',
    description: 'New reports, severity changes, status transitions, and close-outs.',
  },
  {
    key: 'corrective_actions',
    label: 'Corrective actions',
    description: 'Assignments, status changes, verification, and overdue reminders.',
  },
  {
    key: 'inspections',
    label: 'Inspections',
    description: 'Inspection assignments and submissions you need to review.',
  },
  {
    key: 'training',
    label: 'Training',
    description: 'Expiring records, new assignments, and instructor sign-offs.',
  },
  {
    key: 'documents',
    label: 'Documents',
    description: 'New documents to read, review-due reminders, and assignments.',
  },
  {
    key: 'equipment',
    label: 'Equipment',
    description: 'Pre-use inspections needed, work orders, and missing-asset alerts.',
  },
  {
    key: 'ppe',
    label: 'PPE',
    description: 'Issuance reminders, annual checks, and damaged-equipment reports.',
  },
  {
    key: 'jsha',
    label: 'JSHA / HazID',
    description: 'Assessments needing sign-off and locked-record events.',
  },
  {
    key: 'lift_plan',
    label: 'Lift plans',
    description: 'Plans needing approval, signature, or scheduling updates.',
  },
  {
    key: 'lone_worker',
    label: 'Lone worker',
    description: 'Missed check-ins and escalations. Critical — keep at least one channel on.',
  },
  {
    key: 'forms',
    label: 'Forms',
    description: 'Form responses awaiting your review or assigned to you.',
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Scheduled report runs delivered to you.',
  },
]

async function savePreferences(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const userId = ctx.userId
  // We rewrite the union of every (category, channel) pair in our canonical
  // list. Anything not in the canonical list is left untouched so future
  // categories don't get nuked by this form.
  await ctx.db(async (tx) => {
    for (const cat of CATEGORIES) {
      for (const ch of CHANNELS) {
        const fieldName = `pref:${cat.key}:${ch.key}`
        const checked = formData.get(fieldName) === 'on'
        // Upsert: try update, fall back to insert.
        const updated = await tx
          .update(notificationPreferences)
          .set({ enabled: checked })
          .where(
            and(
              eq(notificationPreferences.userId, userId),
              eq(notificationPreferences.tenantId, ctx.tenantId),
              eq(notificationPreferences.category, cat.key),
              eq(notificationPreferences.channel, ch.key),
            ),
          )
          .returning({ id: notificationPreferences.id })
        if (updated.length === 0) {
          await tx.insert(notificationPreferences).values({
            tenantId: ctx.tenantId,
            userId,
            category: cat.key,
            channel: ch.key,
            enabled: checked,
          })
        }
      }
    }
  })
  revalidatePath('/my/notifications')
}

export default async function NotificationPreferencesPage() {
  const ctx = await requireRequestContext()

  const existing = await ctx.db((tx) =>
    tx
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, ctx.userId),
          eq(notificationPreferences.tenantId, ctx.tenantId),
        ),
      ),
  )

  // Index by `${category}:${channel}` so the render loop is O(1) per cell.
  const map = new Map<string, boolean>()
  for (const row of existing) {
    map.set(`${row.category}:${row.channel}`, row.enabled)
  }
  function isEnabled(category: string, channel: Channel): boolean {
    const k = `${category}:${channel}`
    if (map.has(k)) return map.get(k)!
    // Sensible defaults: in_app always on, email on by default, push/sms off.
    if (channel === 'in_app') return true
    if (channel === 'email') return true
    return false
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Notification preferences"
          description="Pick how each category of notification reaches you. In-app messages always appear in your inbox; turning off the in-app channel just stops them from raising the bell badge."
        />

        <form action={savePreferences} className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Category</th>
                  {CHANNELS.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-center font-medium">
                      <div>{c.label}</div>
                      <div className="font-normal normal-case text-[10px] tracking-normal text-slate-400">
                        {c.hint}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {CATEGORIES.map((cat) => {
                  const anyOn = CHANNELS.some((c) => isEnabled(cat.key, c.key))
                  return (
                    <tr key={cat.key} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          {anyOn ? (
                            <Bell size={14} className="mt-0.5 text-teal-600" />
                          ) : (
                            <BellOff size={14} className="mt-0.5 text-slate-400" />
                          )}
                          <div>
                            <div className="font-medium text-slate-900">{cat.label}</div>
                            <div className="text-xs text-slate-500">{cat.description}</div>
                            {!anyOn ? (
                              <Badge variant="warning" className="mt-1 font-normal">
                                All channels muted
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      {CHANNELS.map((ch) => {
                        const fieldName = `pref:${cat.key}:${ch.key}`
                        const checked = isEnabled(cat.key, ch.key)
                        return (
                          <td key={ch.key} className="px-3 py-3 text-center">
                            <label className="inline-flex cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                name={fieldName}
                                defaultChecked={checked}
                                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                              />
                            </label>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Saved preferences apply per tenant. Switching tenants from the top-bar will show that
              tenant's settings.
            </p>
            <Button type="submit">Save preferences</Button>
          </div>
        </form>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Tip:</strong> if you turn off in-app for a category, those notifications still
          land in your <a className="underline" href="/notifications">inbox</a> — they just won't
          raise the bell badge.
        </div>
      </div>
    </PageContainer>
  )
}
