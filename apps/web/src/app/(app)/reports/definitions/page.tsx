import Link from 'next/link'
import { FileText, Sparkles } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadVisibleDefinitions } from '../_definitions'

export const metadata = { title: 'Report definitions' }
export const dynamic = 'force-dynamic'

export default async function DefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const kindFilter = typeof sp.kind === 'string' ? sp.kind : null
  const categoryFilter = typeof sp.category === 'string' ? sp.category : null

  const all = await loadVisibleDefinitions(ctx.tenantId!)
  const definitions = all.filter((d) => {
    if (kindFilter && d.kind !== kindFilter) return false
    if (categoryFilter && d.category !== categoryFilter) return false
    return true
  })

  const categories = Array.from(new Set(all.map((d) => d.category).filter(Boolean))) as string[]
  categories.sort()

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          back={{ href: '/reports', label: 'Back to reports' }}
          title="Report definitions"
          description="The full catalogue of built-in reports plus any custom reports built by your tenant."
          actions={
            <Link href={'/reports/definitions/new' as any}>
              <Button>
                <Sparkles size={14} className="mr-1.5" />
                New custom report
              </Button>
            </Link>
          }
        />

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <FilterChip
            href="/reports/definitions"
            active={!kindFilter && !categoryFilter}
            label={`All (${all.length})`}
          />
          <FilterChip
            href="/reports/definitions?kind=built_in"
            active={kindFilter === 'built_in'}
            label={`Built-in (${all.filter((d) => d.kind === 'built_in').length})`}
          />
          <FilterChip
            href="/reports/definitions?kind=custom"
            active={kindFilter === 'custom'}
            label={`Custom (${all.filter((d) => d.kind === 'custom').length})`}
          />
          <span className="mx-2 text-slate-300">|</span>
          {categories.map((c) => (
            <FilterChip
              key={c}
              href={`/reports/definitions?category=${encodeURIComponent(c)}`}
              active={categoryFilter === c}
              label={c.replace(/_/g, ' ')}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Showing {definitions.length} of {all.length} definition(s)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {definitions.length === 0 ? (
              <EmptyState
                icon={<FileText size={28} />}
                title="No definitions match"
                description="Try clearing the filter, or build a new custom report."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {definitions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link
                          href={`/reports/definitions/${d.id}` as any}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {d.name}
                        </Link>
                        {d.description ? (
                          <p className="mt-0.5 text-xs text-slate-500">{d.description}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {d.category ? (
                          <Badge variant="outline">{d.category.replace(/_/g, ' ')}</Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {d.kind === 'custom' ? (
                          <Badge variant="secondary">custom</Badge>
                        ) : (
                          <Badge variant="outline">built-in</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">{d.slug}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Link href={`/reports/definitions/${d.id}` as any}>
                            <Button variant="ghost" size="sm">
                              Preview
                            </Button>
                          </Link>
                          <Link href={`/reports/schedules/new?definitionId=${d.id}`}>
                            <Button variant="outline" size="sm">
                              Subscribe
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href as any}
      className={
        'rounded-full border px-3 py-1 transition-colors ' +
        (active
          ? 'border-teal-700 bg-teal-700 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-teal-700 hover:text-teal-700')
      }
    >
      {label}
    </Link>
  )
}
