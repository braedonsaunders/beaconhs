import Link from 'next/link'
import { Users } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { pickString } from '@/lib/list-params'
import { listTranscriptPeople } from '../_lib/participants'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Form transcripts' }

export default async function FormTranscriptsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const rawQ = pickString(sp.q) ?? ''
  const q = rawQ.trim().toLowerCase()
  const ctx = await requireRequestContext()
  const all = await listTranscriptPeople(ctx)
  const rows = q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Form transcripts"
            description="Per-person history: every form a person was a participant in or signed."
          />
          <form className="flex items-center gap-2" action="/forms/transcripts" method="get">
            <Input
              name="q"
              type="search"
              placeholder="Search by name…"
              defaultValue={rawQ}
              className="max-w-sm"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No participants"
          description="Submit a form with an attendees section or a person field to build transcripts."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="text-right">Forms participated in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.personId}>
                <TableCell>
                  <Link
                    href={`/forms/transcripts/${r.personId}`}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary">{r.count}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
