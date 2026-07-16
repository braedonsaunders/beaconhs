import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { Alert, AlertDescription, Badge, Card, CardContent } from '@beaconhs/ui'
import { documentVersions, documents } from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { SmartBackLink } from '@/components/smart-back-link'
import { PageContainer } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { contextualizeDocumentDiff, diffDocumentText } from '@/lib/document-text-diff'

export const dynamic = 'force-dynamic'

const PER_PAGE = 200

export default async function DocumentVersionChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; versionId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id, versionId } = await params
  if (!isUuid(id) || !isUuid(versionId)) notFound()
  const [query, tGeneratedValue] = await Promise.all([
    searchParams,
    getGeneratedValueTranslations(),
  ])

  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.read')
  const includeUnpublished = can(ctx, 'documents.manage')

  const data = await ctx.db(async (tx) => {
    const [current] = await tx
      .select({
        documentTitle: documents.title,
        version: documentVersions.version,
        textContent: documentVersions.textContent,
        renderStatus: documentVersions.renderStatus,
        publishedAt: documentVersions.publishedAt,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.documentId, id),
          isNull(documents.deletedAt),
          includeUnpublished ? undefined : isNotNull(documentVersions.publishedAt),
        ),
      )
      .limit(1)
    if (!current) return null

    const [previous] = await tx
      .select({
        version: documentVersions.version,
        textContent: documentVersions.textContent,
        renderStatus: documentVersions.renderStatus,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          lt(documentVersions.version, current.version),
          includeUnpublished ? undefined : isNotNull(documentVersions.publishedAt),
        ),
      )
      .orderBy(desc(documentVersions.version))
      .limit(1)

    return { current, previous: previous ?? null }
  })
  if (!data) notFound()

  const currentReady = data.current.renderStatus === 'complete' && data.current.textContent !== null
  const previousReady =
    data.previous === null ||
    (data.previous.renderStatus === 'complete' && data.previous.textContent !== null)
  const ready = currentReady && previousReady
  const diff = ready
    ? diffDocumentText(data.previous?.textContent ?? '', data.current.textContent ?? '')
    : null
  const rows = diff ? contextualizeDocumentDiff(diff.lines) : []
  const parsedPage = Number(Array.isArray(query.page) ? query.page[0] : query.page)
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const basePath = `/documents/${id}/versions/${versionId}/changes`

  return (
    <PageContainer className="max-w-6xl space-y-4">
      <SmartBackLink
        href={`/documents/${id}?tab=versions`}
        label={tGeneratedValue('Back to version history')}
      />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
          <GeneratedValue value="Changes in version" />{' '}
          <GeneratedValue value={data.current.version} />
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <GeneratedValue value={data.current.documentTitle} /> ·{' '}
          {data.previous ? (
            <GeneratedText id="m_061a13777c72a3" values={{ value0: data.previous.version }} />
          ) : (
            <GeneratedValue value="Compared with the original empty document" />
          )}
        </p>
      </div>

      <GeneratedValue
        value={
          !ready ? (
            <Alert variant="info">
              <AlertDescription>
                <GeneratedValue value="Text comparison is available after both document versions finish rendering. You can still open each Word snapshot from version history and review its native tracked changes." />
              </AlertDescription>
            </Alert>
          ) : diff && diff.additions === 0 && diff.removals === 0 ? (
            <Alert variant="success">
              <AlertDescription>
                <GeneratedValue value="No textual changes were found between these versions." />
              </AlertDescription>
            </Alert>
          ) : diff ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">
                <GeneratedValue value={diff.additions.toLocaleString()} />{' '}
                <GeneratedValue value="added lines" />
              </Badge>
              <Badge variant="destructive">
                <GeneratedValue value={diff.removals.toLocaleString()} />{' '}
                <GeneratedValue value="removed lines" />
              </Badge>
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          ready && rows.length > 0 ? (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto font-mono text-xs">
                  {pageRows.map((row, index) =>
                    row.kind === 'skipped' ? (
                      <div
                        key={`skip-${index}`}
                        className="border-y border-slate-200 bg-slate-50 px-4 py-1.5 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
                      >
                        <GeneratedValue value={row.count.toLocaleString()} />{' '}
                        <GeneratedValue value="unchanged lines" />
                      </div>
                    ) : (
                      <div
                        key={`${row.kind}-${row.beforeLine ?? 'new'}-${row.afterLine ?? 'old'}-${index}`}
                        className={`grid min-w-[40rem] grid-cols-[3.5rem_3.5rem_1.5rem_1fr] border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                          row.kind === 'added'
                            ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100'
                            : row.kind === 'removed'
                              ? 'bg-rose-50 text-rose-950 dark:bg-rose-950/30 dark:text-rose-100'
                              : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="border-r border-slate-200 px-2 py-1 text-right text-slate-400 select-none dark:border-slate-800">
                          <GeneratedValue value={row.beforeLine ?? ''} />
                        </span>
                        <span className="border-r border-slate-200 px-2 py-1 text-right text-slate-400 select-none dark:border-slate-800">
                          <GeneratedValue value={row.afterLine ?? ''} />
                        </span>
                        <span className="px-1 py-1 text-center select-none">
                          <GeneratedValue
                            value={row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
                          />
                        </span>
                        <span className="px-2 py-1 break-words whitespace-pre-wrap">
                          <GeneratedValue value={row.text || ' '} />
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <Pagination
                  basePath={basePath}
                  currentParams={query}
                  total={rows.length}
                  page={page}
                  perPage={PER_PAGE}
                />
              </CardContent>
            </Card>
          ) : null
        }
      />
    </PageContainer>
  )
}
