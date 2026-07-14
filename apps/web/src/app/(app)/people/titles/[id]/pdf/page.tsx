// Browser-printable view of the Job Description for a single title. Users
// hit Cmd/Ctrl+P to save as PDF. All formatting is print-optimised (no app
// shell, no nav). Mirrors the legacy `generatePDF` action in
// `PeopleJobTitleApiController` which used wkhtmltopdf — here we let the
// browser handle the render so we don't need to introduce a worker job.

import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { jobTitleTasks, people, personTitleAssignments, personTitles } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { AutoPrint } from '@/components/browser-print-controls'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Job Description — Print view' }

export default async function TitlePdfPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(personTitles)
      .where(and(eq(personTitles.id, id), isNull(personTitles.deletedAt)))
      .limit(1)
    if (!row) return null
    const tasks = await tx
      .select()
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.titleId, id), isNull(jobTitleTasks.deletedAt)))
      .orderBy(asc(jobTitleTasks.entityOrder), asc(jobTitleTasks.createdAt))
    const assigned = await tx
      .select({ person: people })
      .from(personTitleAssignments)
      .innerJoin(people, eq(people.id, personTitleAssignments.personId))
      .where(
        and(
          eq(personTitleAssignments.titleId, id),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
        ),
      )
      .orderBy(asc(people.lastName), asc(people.firstName))
    return { row, tasks, assigned }
  })
  if (!data) notFound()
  const { row, tasks, assigned } = data
  const today = formatDate(new Date(), ctx.timezone, ctx.locale)

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-sm text-slate-900 print:p-0">
      <header className="mb-6 flex items-start justify-between border-b-2 border-slate-800 pb-3">
        <div>
          <p className="text-[10px] tracking-widest text-slate-500 uppercase">Job Description</p>
          <h1 className="text-2xl font-bold">{row.name}</h1>
        </div>
        <div className="text-right text-xs text-slate-600">
          Generated {today}
          <br />
          {assigned.length} active holders
        </div>
      </header>

      {row.description ? (
        <Section title="Scope">
          <p className="whitespace-pre-wrap">{row.description}</p>
        </Section>
      ) : null}

      {row.responsibilities ? (
        <Section title="Responsibilities">
          <p className="whitespace-pre-wrap">{row.responsibilities}</p>
        </Section>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        {row.education ? (
          <Section title="Education">
            <p className="whitespace-pre-wrap">{row.education}</p>
          </Section>
        ) : null}
        {row.experience ? (
          <Section title="Experience">
            <p className="whitespace-pre-wrap">{row.experience}</p>
          </Section>
        ) : null}
      </div>

      <Section title={`Tasks (${tasks.length})`}>
        {tasks.length === 0 ? (
          <p className="text-xs text-slate-500">No tasks defined for this title.</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-slate-300 text-left">
                <th className="w-8 py-1">#</th>
                <th className="py-1">Task</th>
                <th className="py-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={t.id} className="border-b border-slate-200 align-top">
                  <td className="py-1 font-medium">{i + 1}</td>
                  <td className="py-1 font-medium">{t.task}</td>
                  <td className="py-1 whitespace-pre-wrap text-slate-600">
                    {t.description ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Sign-off">
        <p className="mb-3 text-xs text-slate-600">
          I have read and understood the responsibilities and tasks above. I will perform my duties
          according to this Job Description.
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1">Print name</th>
              <th className="py-1">Signature</th>
              <th className="py-1">Date</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-6">&nbsp;</td>
              <td className="py-6">&nbsp;</td>
              <td className="py-6">&nbsp;</td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-6">&nbsp;</td>
              <td className="py-6">&nbsp;</td>
              <td className="py-6">&nbsp;</td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-6">&nbsp;</td>
              <td className="py-6">&nbsp;</td>
              <td className="py-6">&nbsp;</td>
            </tr>
          </tbody>
        </table>
      </Section>

      {assigned.length > 0 ? (
        <Section title="Currently assigned">
          <ul className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
            {assigned.map(({ person }) => (
              <li key={person.id}>
                · {person.lastName}, {person.firstName}
                {person.employeeNo ? ` (${person.employeeNo})` : ''}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <footer className="mt-8 border-t border-slate-300 pt-2 text-[10px] text-slate-500">
        Job Description · {row.name} · Page printed from BeaconHS on {today}
      </footer>

      <AutoPrint />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 break-inside-avoid">
      <h2 className="mb-1 border-b border-slate-300 text-base font-semibold">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}
