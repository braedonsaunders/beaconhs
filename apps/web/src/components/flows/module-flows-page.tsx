// Shared server component for a native module's Flows authoring page. Each
// module's /<module>/flows/page.tsx is a one-liner: <ModuleFlowsPage moduleKey=… />.
// Renders the SAME FlowsCanvas as Builder, driven by the module's profile.

import { redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { formAutomations } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { listActiveEmailTemplatesForSubject } from '@/lib/email-templates'
import { listActivePdfTemplatesForSubject } from '@/lib/pdf-templates'
import { moduleFlowProfile } from '@/lib/flows/module-profiles'
import { loadRecipientOptions } from '@/lib/flows/recipient-options'
import { FlowsCanvas, type FlowSummary } from '@/app/(app)/apps/templates/[id]/flows/_flows-canvas'

export async function ModuleFlowsPage({ moduleKey }: { moduleKey: string }) {
  const ctx = await requireModuleManage(moduleKey)
  const profile = moduleFlowProfile(moduleKey)
  const mod = moduleAdminByKey(moduleKey === 'document-signoffs' ? 'documents' : moduleKey)
  if (!profile || !mod) redirect('/')

  const [flowsRaw, emailTemplates, pdfTemplates, recipientOptions] = await Promise.all([
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
          and(eq(formAutomations.subjectType, 'module'), eq(formAutomations.subjectKey, moduleKey)),
        )
        .orderBy(asc(formAutomations.createdAt)),
    ),
    listActiveEmailTemplatesForSubject(ctx, 'module', moduleKey),
    listActivePdfTemplatesForSubject(ctx, 'module', moduleKey),
    loadRecipientOptions(ctx),
  ])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FlowsCanvas
        profile={profile}
        emailTemplates={emailTemplates}
        pdfTemplates={pdfTemplates}
        recipientOptions={recipientOptions}
        flows={flowsRaw as FlowSummary[]}
        canEdit
        canGenerate={false}
        backHref={mod.managePath}
      />
    </div>
  )
}
