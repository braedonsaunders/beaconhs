import Link from 'next/link'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { createTitle } from '../../_actions/titles'

export const metadata = { title: 'New job title' }
export const dynamic = 'force-dynamic'

export default async function NewTitlePage() {
  await requireModuleManage('people')
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-5">
        <DetailHeader
          back={{ href: '/people/titles', label: 'Back to titles' }}
          title="New job title"
          subtitle="Define the Job Description fields once — every person assigned to this title shares them."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createTitle} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required placeholder="e.g. Pipe Welder" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Scope</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder="One-paragraph summary that opens the Job Description PDF."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="responsibilities">Responsibilities</Label>
                <Textarea
                  id="responsibilities"
                  name="responsibilities"
                  rows={6}
                  placeholder="Bullet list of duties — use line breaks to separate."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="education">Education</Label>
                <Textarea
                  id="education"
                  name="education"
                  rows={3}
                  placeholder="Required certifications, trade tickets, formal training."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="experience">Experience</Label>
                <Textarea
                  id="experience"
                  name="experience"
                  rows={3}
                  placeholder="Minimum years on the tools, prior roles, etc."
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Link href="/people/titles">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Create title</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
