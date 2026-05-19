import Link from 'next/link'
import { BadgeCheck, FileText, IdCard } from 'lucide-react'
import { asc, count } from 'drizzle-orm'
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
import {
  jobTitleTasks,
  personTitleAssignments,
  personTitles,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from '../_components/people-sub-nav'

export const metadata = { title: 'People — Titles' }
export const dynamic = 'force-dynamic'

export default async function TitlesPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db(async (tx) => {
    const all = await tx.select().from(personTitles).orderBy(asc(personTitles.name))
    const assignmentCounts = await tx
      .select({ titleId: personTitleAssignments.titleId, c: count() })
      .from(personTitleAssignments)
      .groupBy(personTitleAssignments.titleId)
    const taskCounts = await tx
      .select({ titleId: jobTitleTasks.titleId, c: count() })
      .from(jobTitleTasks)
      .groupBy(jobTitleTasks.titleId)
    const acById = new Map(assignmentCounts.map((c) => [c.titleId, Number(c.c)]))
    const tcById = new Map(taskCounts.map((c) => [c.titleId, Number(c.c)]))
    return all.map((t) => ({
      ...t,
      assignedCount: acById.get(t.id) ?? 0,
      taskCount: tcById.get(t.id) ?? 0,
    }))
  })

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="titles" />
          <PageHeader
            title="Job titles"
            description="Formal title catalogue with structured Job Description fields, per-title task lists, and per-person sign-offs."
            actions={
              <Link href="/people/titles/new">
                <Button>Add title</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<IdCard size={32} />}
          title="No titles yet"
          description="Define the formal job titles used in your Job Description PDFs."
          action={
            <Link href="/people/titles/new">
              <Button>Add your first title</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>People</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link
                    href={`/people/titles/${t.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {t.name}
                  </Link>
                </TableCell>
                <TableCell className="text-slate-600">
                  {t.description ? (
                    <span className="line-clamp-2">{t.description}</span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    <BadgeCheck size={10} />
                    {t.assignedCount}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    <FileText size={10} />
                    {t.taskCount}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2 text-xs">
                    <Link
                      href={`/people/titles/${t.id}/tasks`}
                      className="text-teal-700 hover:underline"
                    >
                      Tasks
                    </Link>
                    <span className="text-slate-300">·</span>
                    <Link
                      href={`/people/titles/${t.id}/pdf`}
                      className="text-teal-700 hover:underline"
                      target="_blank"
                    >
                      PDF
                    </Link>
                    <span className="text-slate-300">·</span>
                    <Link
                      href={`/people/titles/${t.id}`}
                      className="text-teal-700 hover:underline"
                    >
                      View →
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
