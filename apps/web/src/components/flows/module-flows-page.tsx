// Shared server component for a native module's Flows authoring page. Each
// module's /<module>/flows/page.tsx is a one-liner: <ModuleFlowsPage moduleKey=… />.
// Renders the SAME FlowsCanvas as Builder, driven by the module's profile.

import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { formAutomations } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { listActiveEmailTemplates } from '@/lib/email-templates'
import { moduleFlowProfile } from '@/lib/flows/module-profiles'
import { FlowsCanvas, type FlowSummary } from '@/app/(app)/forms/templates/[id]/flows/_flows-canvas'

export async function ModuleFlowsPage({ moduleKey }: { moduleKey: string }) {
  const ctx = await requireModuleManage(moduleKey)
  const profile = moduleFlowProfile(moduleKey)
  const mod = moduleAdminByKey(moduleKey)
  if (!profile || !mod) redirect('/')

  const [flowsRaw, emailTemplates] = await Promise.all([
    ctx.db((tx) =>
      tx
        .select({
          id: formAutomations.id,
          name: formAutomations.name,
          enabled: formAutomations.enabled,
          graph: formAutomations.graph,
        })
        .from(formAutomations)
        .where(
          and(
            eq(formAutomations.subjectType, 'module'),
            eq(formAutomations.subjectKey, moduleKey),
          ),
        )
        .orderBy(asc(formAutomations.createdAt)),
    ),
    listActiveEmailTemplates(ctx),
  ])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FlowsCanvas
        profile={profile}
        emailTemplates={emailTemplates}
        flows={flowsRaw as FlowSummary[]}
        canEdit
        canGenerate={false}
        backHref={mod.managePath}
      />
    </div>
  )
}
