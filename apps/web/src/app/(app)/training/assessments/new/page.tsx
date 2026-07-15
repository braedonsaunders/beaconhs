import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
import { PersonSelectField } from '@/components/person-select-field'
import { startAssessmentAttempt } from '../../_actions/assessments'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_15deae186697d1') }
}
export const dynamic = 'force-dynamic'

export default async function NewAssessmentAttemptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const defaultTypeId =
    typeof sp.typeId === 'string' ? sp.typeId : Array.isArray(sp.typeId) ? sp.typeId[0] : undefined
  const defaultPersonId =
    typeof sp.personId === 'string'
      ? sp.personId
      : Array.isArray(sp.personId)
        ? sp.personId[0]
        : undefined
  const complianceObligationId =
    typeof sp.obligationId === 'string'
      ? sp.obligationId
      : Array.isArray(sp.obligationId)
        ? sp.obligationId[0]
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
          title={tGenerated('m_001c77d9e1b513')}
          subtitle={tGenerated('m_139268fbdc7d7d')}
        />

        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_06157d11c8c6f8" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={startAssessmentAttempt} className="space-y-4">
              <GeneratedValue
                value={
                  complianceObligationId ? (
                    <input
                      type="hidden"
                      name="complianceObligationId"
                      value={complianceObligationId}
                    />
                  ) : null
                }
              />
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_12e926c9216094" />{' '}
                  <span className="text-red-600 dark:text-red-400">*</span>
                </Label>
                <PersonSelectField
                  name="personId"
                  defaultValue={defaultPersonId ?? ''}
                  clearable={false}
                  placeholder={tGenerated('m_0c0d8d4b86c7c4')}
                  options={peopleRows.map((p) => ({
                    value: p.id,
                    label: `${p.lastName}, ${p.firstName}`,
                    hint: p.employeeNo ?? undefined,
                  }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_169ce2294296b8" />{' '}
                  <span className="text-red-600 dark:text-red-400">*</span>
                </Label>
                <Select name="typeId" required defaultValue={defaultTypeId ?? ''}>
                  <option value="" disabled>
                    <GeneratedText id="m_14e679efd24fb2" />
                  </option>
                  <GeneratedValue
                    value={types
                      .filter((t) => t.active)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          <GeneratedValue value={t.name} />
                        </option>
                      ))}
                  />
                </Select>
              </div>
              <div className="flex justify-end">
                <Button type="submit">
                  <GeneratedText id="m_11fba073891fbd" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_10369e22e0294b" />
        </p>
      </div>
    </PageContainer>
  )
}
