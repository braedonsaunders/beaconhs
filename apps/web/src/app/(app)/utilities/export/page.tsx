import Link from 'next/link'
import { Download } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { EXPORTABLE_ENTITIES } from './_entities'

export const metadata = { title: 'Data export' }

// Group entries by their groupLabel so the page renders one card per group.
function groupEntities() {
  const groups = new Map<string, typeof EXPORTABLE_ENTITIES>()
  for (const e of EXPORTABLE_ENTITIES) {
    const arr = groups.get(e.groupLabel) ?? []
    arr.push(e)
    groups.set(e.groupLabel, arr)
  }
  return Array.from(groups.entries())
}

export default function ExportHubPage() {
  const groups = groupEntities()
  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Data export"
          description="Bulk download records as CSV. Each export is logged to the audit trail."
          back={{ href: '/utilities', label: 'All utilities' }}
        />
        <Alert>
          <AlertTitle>How this page works</AlertTitle>
          <AlertDescription>
            Picking an entity opens the canonical CSV endpoint shipped by that module — the same one
            the module&apos;s list page uses. Filters carried through query string apply; for
            &quot;everything&quot; export, just click the button.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(([groupLabel, entries]) => (
            <Card key={groupLabel}>
              <CardHeader>
                <CardTitle>{groupLabel}</CardTitle>
                <CardDescription>
                  {entries.length} entit{entries.length === 1 ? 'y' : 'ies'} available.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-slate-100">
                  {entries.map((e) => (
                    <li key={e.key} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900">{e.label}</div>
                        <div className="text-xs text-slate-500">{e.description}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Link href={e.csvHref as any}>
                          <Button variant="outline" size="sm">
                            <Download size={14} className="mr-1.5" /> CSV
                          </Button>
                        </Link>
                        {e.jsonHref ? (
                          <Link href={e.jsonHref as any}>
                            <Button variant="outline" size="sm">
                              JSON
                            </Button>
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
