import Link from 'next/link'
import { and, count, desc, eq, ilike, or } from 'drizzle-orm'
import { attachments, trainingSkillTypeFiles } from '@beaconhs/db/schema'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import { GeneratedText } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parsePrefixedListParams, pickString } from '@/lib/list-params'
import { attachmentUrl } from '@/lib/attachment-url'
import { FilePreview } from '@/components/file-preview'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { ConfirmButton } from '@/components/confirm-button'
import { TrainingFilesDrawer } from '../../../_components/files-drawer'
import { addSkillTypeFile, removeSkillTypeFile } from '../_files-actions'

export async function SkillTypeFiles({
  id,
  searchParams: sp,
}: {
  id: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const ctx = await requireModuleManage('training')
  const t = await getGeneratedTranslations()
  const params = parsePrefixedListParams(sp, 'file', {
    sort: 'uploaded',
    dir: 'desc',
    perPage: 25,
    allowedSorts: ['uploaded'],
  })
  const kind = pickString(sp.fileKind)
  const path = `/training/skills/types/${id}`
  const { rows, total } = await ctx.db(async (tx) => {
    const where = and(
      eq(trainingSkillTypeFiles.skillTypeId, id),
      kind ? eq(trainingSkillTypeFiles.kind, kind) : undefined,
      params.q
        ? or(
            ilike(trainingSkillTypeFiles.label, `%${params.q}%`),
            ilike(attachments.filename, `%${params.q}%`),
          )
        : undefined,
    )
    const [total] = await tx
      .select({ count: count() })
      .from(trainingSkillTypeFiles)
      .innerJoin(attachments, eq(attachments.id, trainingSkillTypeFiles.attachmentId))
      .where(where)
    const rows = await tx
      .select({ file: trainingSkillTypeFiles, attachment: attachments })
      .from(trainingSkillTypeFiles)
      .innerJoin(attachments, eq(attachments.id, trainingSkillTypeFiles.attachmentId))
      .where(where)
      .orderBy(desc(trainingSkillTypeFiles.uploadedAt), desc(trainingSkillTypeFiles.id))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows, total: Number(total?.count ?? 0) }
  })
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            <GeneratedText id="m_09a3c98fe10087" />
            {total})
          </CardTitle>
          <Link href={`${path}?tab=files&drawer=upload-file`}>
            <Button>
              <GeneratedText id="m_06dc5804d9c769" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <TableToolbar>
          <SearchInput
            paramKey="fileQ"
            pageParamKey="filePage"
            placeholder={t('m_1f5c890597604d')}
          />
          <FilterChips
            basePath={path}
            currentParams={sp}
            paramKey="fileKind"
            label={t('m_1e578efe1574cd')}
            clearParams={['filePage']}
            options={[
              { value: 'certificate', label: 'Certificate' },
              { value: 'evidence', label: 'Supporting evidence' },
              { value: 'photo', label: 'Photo' },
              { value: 'other', label: 'Other' },
            ]}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          <p>
            <GeneratedText id="m_1192d4035da0ad" />
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ file, attachment }) => (
              <div
                key={file.id}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <a href={attachmentUrl(attachment.id)} target="_blank" rel="noopener noreferrer">
                  <FilePreview
                    url={attachmentUrl(attachment.id)}
                    contentType={attachment.contentType}
                    label={file.label}
                  />
                  <span className="font-medium underline">{file.label}</span>
                </a>
                <p className="text-xs text-slate-500">{attachment.filename}</p>
                <form action={removeSkillTypeFile}>
                  <input type="hidden" name="skillTypeId" value={id} />
                  <input type="hidden" name="fileId" value={file.id} />
                  <ConfirmButton message={t('m_0d1c769724550a')} variant="outline" size="sm">
                    <GeneratedText id="m_1a9d8d971b1edb" />
                  </ConfirmButton>
                </form>
              </div>
            ))}
          </div>
        )}
        <Pagination
          basePath={path}
          currentParams={sp}
          total={total}
          page={params.page}
          perPage={params.perPage}
          pageParamKey="filePage"
        />
        <TrainingFilesDrawer
          recordId={id}
          addFileAction={addSkillTypeFile}
          open={pickString(sp.drawer) === 'upload-file'}
          closeHref={`${path}?tab=files`}
        />
      </CardContent>
    </Card>
  )
}
