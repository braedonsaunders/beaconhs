// In-browser PowerPoint editor for a PPTX-mastered training deck. Embeds
// Collabora Online against this app's WOPI host: opening the page mints a
// single-file access token, the frame loads the master from /wopi/files/*, and
// every save re-renders the learner-facing slides automatically.

import { notFound } from 'next/navigation'
import { Download, Presentation } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { buildEditorUrl, getCollaboraEditUrl } from '@/lib/collabora'
import { mintWopiToken } from '@/lib/wopi'
import { PageContainer } from '@/components/page-layout'
import { SmartBackLink } from '@/components/smart-back-link'
import { CollaboraFrame } from './_frame'
import { loadDeckMaster, parseDeckTarget } from './_lib'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'PowerPoint editor' }

export default async function PptxEditorPage({
  params,
}: {
  params: Promise<{ target: string; id: string }>
}) {
  const { target: targetRaw, id } = await params
  const target = parseDeckTarget(targetRaw)
  if (!target) notFound()

  const ctx = await requireModuleManage('training')
  const master = await loadDeckMaster(ctx.db, target, id)
  if (!master) notFound()

  const editUrl = await getCollaboraEditUrl()
  const downloadHref = `/training/pptx/${target}/${id}/download`

  if (!editUrl) {
    return (
      <PageContainer>
        <SmartBackLink href={master.backHref} label="Back" />
        <div className="mt-4 max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-950/40">
          <h1 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Presentation size={16} /> PowerPoint editing is not configured
          </h1>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            The in-browser PowerPoint editor needs a Collabora Online server. Set{' '}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">COLLABORA_URL</code>{' '}
            (and{' '}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">
              COLLABORA_WOPI_URL
            </code>{' '}
            if the app is not reachable at APP_URL from the Collabora container), then reload.
          </p>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            The deck still plays from its last render, and the master file stays available for
            download.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href={downloadHref}>
              <Download size={13} /> Download PowerPoint
            </a>
          </Button>
        </div>
      </PageContainer>
    )
  }

  const { token, exp } = mintWopiToken({
    attachmentId: master.attachment.id,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userName: ctx.membership?.displayName ?? 'BeaconHS user',
    target,
    targetId: id,
    canWrite: true,
  })

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <SmartBackLink href={master.backHref} label="Back" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {master.title}
          </h1>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {master.attachment.filename} — changes save automatically and the slideshow re-renders
            after each save.
          </p>
        </div>
        <div className="ml-auto">
          <Button asChild variant="outline" size="sm">
            <a href={downloadHref}>
              <Download size={13} /> Download PowerPoint
            </a>
          </Button>
        </div>
      </div>
      <CollaboraFrame
        actionUrl={buildEditorUrl(editUrl, master.attachment.id)}
        accessToken={token}
        accessTokenTtl={exp}
      />
    </div>
  )
}
