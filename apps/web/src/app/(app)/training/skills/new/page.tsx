// New skill — issue a skill/certification assignment to a person. Person + skill
// type are required; expiry auto-computes from the skill type when left blank.
// On submit the assignment is created and opened, where the rest edits inline.

import { redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { people, trainingSkillAuthorities, trainingSkillTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { createSkillAssignment } from '../_actions'

export const metadata = { title: 'New skill' }
export const dynamic = 'force-dynamic'

export default async function NewSkillPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const defaultPersonId = typeof sp.personId === 'string' ? sp.personId : ''
  const defaultTypeId = typeof sp.skillTypeId === 'string' ? sp.skillTypeId : ''

  const ctx = await requireRequestContext()
  // Managing skills requires training.course.manage; createSkillAssignment
  // re-checks server-side.
  if (!canManageModule(ctx, 'training')) redirect('/training/skills')

  const [types, peopleRows] = await ctx.db(async (tx) => {
    const t = await tx
      .select({
        id: trainingSkillTypes.id,
        name: trainingSkillTypes.name,
        code: trainingSkillTypes.code,
        authorityName: trainingSkillAuthorities.name,
      })
      .from(trainingSkillTypes)
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .orderBy(asc(trainingSkillAuthorities.name), asc(trainingSkillTypes.name))
    const p = await tx
      .select()
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return [t, p] as const
  })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/training/skills', label: 'Back to skills' }}
          title="New skill"
          subtitle="Issue a skill or certification to a person. You can edit the rest of the details after it's created."
        />

        <Card>
          <CardHeader>
            <CardTitle>Skill details</CardTitle>
          </CardHeader>
          <CardContent>
            {types.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No skill types exist yet. Create one under{' '}
                <a
                  href="/training/skills/types"
                  className="font-medium text-teal-700 hover:underline dark:text-teal-300"
                >
                  Manage → Skill types
                </a>{' '}
                first.
              </p>
            ) : (
              <form action={createSkillAssignment} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>
                    Person <span className="text-red-600 dark:text-red-400">*</span>
                  </Label>
                  <PersonSelectField
                    name="personId"
                    defaultValue={defaultPersonId}
                    clearable={false}
                    placeholder="Choose a person…"
                    options={peopleRows.map((p) => ({
                      value: p.id,
                      label: `${p.lastName}, ${p.firstName}`,
                      hint: p.employeeNo ?? undefined,
                    }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="skillTypeId">
                    Skill / certification{' '}
                    <span className="text-red-600 dark:text-red-400">*</span>
                  </Label>
                  <Select id="skillTypeId" name="skillTypeId" required defaultValue={defaultTypeId}>
                    <option value="" disabled>
                      Choose a skill type…
                    </option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.authorityName} · {t.code ? `${t.code} · ` : ''}
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="grantedOn">
                      Granted on <span className="text-red-600 dark:text-red-400">*</span>
                    </Label>
                    <Input
                      id="grantedOn"
                      name="grantedOn"
                      type="date"
                      required
                      defaultValue={today}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expiresOn">Expires on</Label>
                    <Input id="expiresOn" name="expiresOn" type="date" />
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      Leave blank to auto-compute from the skill type.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    rows={3}
                    placeholder="Internal notes about this credential"
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit">Create skill</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
