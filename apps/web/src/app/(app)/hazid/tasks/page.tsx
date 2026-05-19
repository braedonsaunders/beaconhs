import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { asc, isNull } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { hazidTasks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { HazidSubNav } from '../_subnav'

export const metadata = { title: 'Task library' }
export const dynamic = 'force-dynamic'

export default async function TaskLibraryPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx.select().from(hazidTasks).where(isNull(hazidTasks.deletedAt)).orderBy(asc(hazidTasks.name)),
  )
  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/tasks" />
          <PageHeader
            title="Task library"
            description="Reusable task descriptions with default hazards / controls."
            actions={
              <Link href="/hazid/tasks/new">
                <Button>New task</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title="No tasks yet"
          description="Build out common job steps so crews can pull them into an assessment."
          action={
            <Link href="/hazid/tasks/new">
              <Button>Add task</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Linked hazards</TableHead>
              <TableHead>Default controls</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/hazid/tasks/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.hazardIds.length}</Badge>
                </TableCell>
                <TableCell className="max-w-xl truncate text-slate-600">
                  {r.controls ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
