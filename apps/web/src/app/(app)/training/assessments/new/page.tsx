import { asc, eq, isNull } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Label,
  Select,
} from '@beaconhs/ui'
import { people, trainingAssessmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { startAssessmentAttempt } from '../../_actions/assessments'

export const metadata = { title: 'New assessment attempt' }
export const dynamic = 'force-dynamic'

export default async function NewAssessmentAttemptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const defaultTypeId =
    typeof sp.typeId === 'string' ? sp.typeId : Array.isArray(sp.typeId) ? sp.typeId[0] : undefined
  const defaultPersonId =
    typeof sp.personId === 'string'
      ? sp.personId
      : Array.isArray(sp.personId)
        ? sp.personId[0]
        : undefined

  const ctx = await requireRequestContext()
  const [types, peopleRows] = await ctx.db(async (tx) => {
    const t = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(isNull(trainingAssessmentTypes.deletedAt))
      .orderBy(asc(trainingAssessmentTypes.name))
    const p = await tx
      .select()
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return [t, p] as const
  })

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/training/assessments', label: 'Back to assessments' }}
          title="Start a new assessment attempt"
          subtitle="Pick the candidate and the assessment type. You'll be taken to the question sheet to record answers and submit for grading."
        />

        <Card>
          <CardHeader>
            <CardTitle>Attempt details</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={startAssessmentAttempt} className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  Person <span className="text-red-600">*</span>
                </Label>
                <Select name="personId" required defaultValue={defaultPersonId ?? ''}>
                  <option value="" disabled>
                    Choose a person…
                  </option>
                  {peopleRows.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.lastName}, {p.firstName}
                      {p.employeeNo ? ` (#${p.employeeNo})` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Assessment type <span className="text-red-600">*</span>
                </Label>
                <Select name="typeId" required defaultValue={defaultTypeId ?? ''}>
                  <option value="" disabled>
                    Choose an assessment type…
                  </option>
                  {types
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </Select>
              </div>
              <div className="flex justify-end">
                <Button type="submit">Begin attempt</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="text-xs text-slate-500">
          The attempt opens in "in progress" status. Submitting auto-grades it from each question's
          correct answer and points value. Passing an assessment type that's linked to a course also
          writes a training record.
        </p>
      </div>
    </PageContainer>
  )
}
