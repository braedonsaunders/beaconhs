import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_16688299d80d73') }
}

export default async function TitlePdfPage({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
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
          <p className="text-[10px] tracking-widest text-slate-500 uppercase">
            <GeneratedText id="m_02a4fc25a429a2" />
          </p>
          <h1 className="text-2xl font-bold">
            <GeneratedValue value={row.name} />
          </h1>
        </div>
        <div className="text-right text-xs text-slate-600">
          <GeneratedText id="m_15b5d2aa5d84c5" /> <GeneratedValue value={today} />
          <br />
          <GeneratedValue value={assigned.length} /> <GeneratedText id="m_1d6df42a5c4d45" />
        </div>
      </header>

      <GeneratedValue
        value={
          row.description ? (
            <Section title={tGenerated('m_1f10a46fc1db73')}>
              <p className="whitespace-pre-wrap">
                <GeneratedValue value={row.description} />
              </p>
            </Section>
          ) : null
        }
      />

      <GeneratedValue
        value={
          row.responsibilities ? (
            <Section title={tGenerated('m_10db3552a638bc')}>
              <p className="whitespace-pre-wrap">
                <GeneratedValue value={row.responsibilities} />
              </p>
            </Section>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <GeneratedValue
          value={
            row.education ? (
              <Section title={tGenerated('m_01f50b9a132c18')}>
                <p className="whitespace-pre-wrap">
                  <GeneratedValue value={row.education} />
                </p>
              </Section>
            ) : null
          }
        />
        <GeneratedValue
          value={
            row.experience ? (
              <Section title={tGenerated('m_054359abce46c6')}>
                <p className="whitespace-pre-wrap">
                  <GeneratedValue value={row.experience} />
                </p>
              </Section>
            ) : null
          }
        />
      </div>

      <Section title={tGenerated('m_07a60b8f0641f7', { value0: tasks.length })}>
        <GeneratedValue
          value={
            tasks.length === 0 ? (
              <p className="text-xs text-slate-500">
                <GeneratedText id="m_0332439d903286" />
              </p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-300 text-left">
                    <th className="w-8 py-1">#</th>
                    <th className="py-1">
                      <GeneratedText id="m_1b00bbb667318a" />
                    </th>
                    <th className="py-1">
                      <GeneratedText id="m_1b34818ce3a832" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <GeneratedValue
                    value={tasks.map((t, i) => (
                      <tr key={t.id} className="border-b border-slate-200 align-top">
                        <td className="py-1 font-medium">
                          <GeneratedValue value={i + 1} />
                        </td>
                        <td className="py-1 font-medium">
                          <GeneratedValue value={t.task} />
                        </td>
                        <td className="py-1 whitespace-pre-wrap text-slate-600">
                          <GeneratedValue value={t.description ?? '—'} />
                        </td>
                      </tr>
                    ))}
                  />
                </tbody>
              </table>
            )
          }
        />
      </Section>

      <Section title={tGenerated('m_1eab968d964918')}>
        <p className="mb-3 text-xs text-slate-600">
          <GeneratedText id="m_027be7b7d6cdb0" />
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1">
                <GeneratedText id="m_1388ad844d838a" />
              </th>
              <th className="py-1">
                <GeneratedText id="m_0c0bc02db58371" />
              </th>
              <th className="py-1">
                <GeneratedText id="m_0285c38761c540" />
              </th>
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

      <GeneratedValue
        value={
          assigned.length > 0 ? (
            <Section title={tGenerated('m_048062747ecd52')}>
              <ul className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
                <GeneratedValue
                  value={assigned.map(({ person }) => (
                    <li key={person.id}>
                      · <GeneratedValue value={person.lastName} />,{' '}
                      <GeneratedValue value={person.firstName} />
                      <GeneratedValue value={person.employeeNo ? ` (${person.employeeNo})` : ''} />
                    </li>
                  ))}
                />
              </ul>
            </Section>
          ) : null
        }
      />

      <footer className="mt-8 border-t border-slate-300 pt-2 text-[10px] text-slate-500">
        <GeneratedText id="m_112caa5a7ae036" /> <GeneratedValue value={row.name} />{' '}
        <GeneratedText id="m_1e737334e44c70" /> <GeneratedValue value={today} />
      </footer>

      <AutoPrint />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 break-inside-avoid">
      <h2 className="mb-1 border-b border-slate-300 text-base font-semibold">
        <GeneratedValue value={title} />
      </h2>
      <div className="mt-2">
        <GeneratedValue value={children} />
      </div>
    </section>
  )
}
